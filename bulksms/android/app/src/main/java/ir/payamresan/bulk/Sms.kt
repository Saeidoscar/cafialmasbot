package ir.payamresan.bulk

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.telephony.SmsManager
import android.telephony.SubscriptionManager
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * ارسال پیامک با SmsManager + انتظار برای نتیجهٔ واقعی هر پیام.
 * Sending with SmsManager and waiting for the real per-message result.
 */
object Sms {

    class Result(val ok: Boolean, val error: String?, val parts: Int)

    /** توکن‌های در انتظار نتیجه: token → latch */
    private val waiters = ConcurrentHashMap<String, CountDownLatch>()
    private val results = ConcurrentHashMap<String, Result>()
    private val delivered = ConcurrentHashMap<String, String>()  // token -> delivery status

    const val ACTION_SENT = "ir.payamresan.bulk.SMS_SENT"
    const val ACTION_DELIVERED = "ir.payamresan.bulk.SMS_DELIVERED"
    const val EXTRA_TOKEN = "token"

    fun manager(context: Context, subId: Int): SmsManager {
        return try {
            if (subId >= 0) SmsManager.getSmsManagerForSubscriptionId(subId)
            else if (Build.VERSION.SDK_INT >= 31) context.getSystemService(SmsManager::class.java)
            else SmsManager.getDefault()
        } catch (e: Exception) {
            if (Build.VERSION.SDK_INT >= 31) context.getSystemService(SmsManager::class.java) else SmsManager.getDefault()
        }
    }

    fun pendingFlags(): Int =
        if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        else PendingIntent.FLAG_UPDATE_CURRENT

    /**
     * ارسال یک پیام (چندبخشی در صورت نیاز) و انتظار تا حداکثر timeoutMs برای نتیجه.
     */
    fun sendSync(
        context: Context,
        subId: Int,
        number: String,
        text: String,
        token: String,
        timeoutMs: Long = 90_000
    ): Result {
        val sm = manager(context, subId)
        val parts = try { sm.divideMessage(text) } catch (e: Exception) { null }
        if (parts == null || parts.isEmpty()) return Result(false, "متن پیام خالی یا نامعتبر است", 0)

        val latch = CountDownLatch(1)
        waiters[token] = latch

        val sentList = ArrayList<PendingIntent>()
        val delList = ArrayList<PendingIntent>()
        for (i in parts.indices) sentList.add(intent(context, ACTION_SENT, token + "#" + i, token.hashCode() + i))
        for (i in parts.indices) delList.add(intent(context, ACTION_DELIVERED, token + "#" + i, token.hashCode() + 7000 + i))

        try {
            sm.sendMultipartTextMessage(number, null, parts, sentList, delList)
        } catch (e: Exception) {
            waiters.remove(token)
            return Result(false, "خطای ارسال: ${e.message ?: e.javaClass.simpleName}", parts.size)
        }
        val got = try { latch.await(timeoutMs, TimeUnit.MILLISECONDS) } catch (e: InterruptedException) { false }
        waiters.remove(token)
        val res = results.remove(token)
        if (!got || res == null) return Result(false, "پاسخی از شبکه دریافت نشد (timeout)", parts.size)
        return Result(res.ok, res.error, parts.size)
    }

    private fun intent(context: Context, action: String, token: String, reqCode: Int): PendingIntent {
        val i = Intent(context, SmsStatusReceiver::class.java)
        i.action = action
        i.putExtra(EXTRA_TOKEN, token)
        return PendingIntent.getBroadcast(context, reqCode, i, pendingFlags())
    }

    fun statusOf(token: String): String? = delivered[token]

    /** فراخوانی از BroadcastReceiver */
    fun onSent(baseToken: String, resultCode: Int) {
        delivered.remove(baseToken)
        val msg = when (resultCode) {
            android.app.Activity.RESULT_OK -> null
            SmsManager.RESULT_ERROR_GENERIC_FAILURE -> "خطای عمومی مخابراتی"
            SmsManager.RESULT_ERROR_NO_SERVICE -> "پوشش شبکه نیست"
            SmsManager.RESULT_ERROR_NULL_PDU -> "PDU خالی"
            SmsManager.RESULT_ERROR_RADIO_OFF -> "رادیو گوشی خاموش است (حالت پرواز)"
            SmsManager.RESULT_ERROR_SHORT_CODE_NOT_ALLOWED -> "شمارهٔ سرویس مجاز نیست"
            SmsManager.RESULT_ERROR_SHORT_CODE_NEVER_ALLOWED -> "شمارهٔ سرویس مجاز نیست"
            else -> "کد خطای $resultCode"
        }
        results[baseToken] = Result(msg == null, msg, 0)
        waiters[baseToken]?.countDown()
    }

    fun onDelivered(baseToken: String) {
        delivered[baseToken] = "تحویل شد"
    }

    /** سیم‌کارت‌های فعال گوشی. */
    data class Sim(val subId: Int, val slot: Int, val name: String, val carrier: String, val number: String)

    fun sims(context: Context): List<Sim> {
        val out = ArrayList<Sim>()
        try {
            val sm = context.getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE) as? SubscriptionManager ?: return defaultSims(context)
            val list = sm.activeSubscriptionInfoList
            if (list != null) {
                for (info in list) {
                    val carrier = try { info.carrierName?.toString() ?: "" } catch (e: Exception) { "" }
                    val num = try { info.number ?: "" } catch (e: Exception) { "" }
                    out.add(Sim(info.subscriptionId, info.simSlotIndex, info.displayName?.toString() ?: "سیم‌کارت", carrier, num))
                }
            }
        } catch (e: Exception) {
            // دسترسی READ_PHONE_STATE داده نشده
        }
        if (out.isEmpty()) return defaultSims(context)
        return out
    }

    private fun defaultSims(context: Context): List<Sim> {
        val out = ArrayList<Sim>()
        try {
            val id = SubscriptionManager.getDefaultSmsSubscriptionId()
            out.add(Sim(id, 0, "پیش‌فرض", "", ""))
        } catch (e: Exception) {
            out.add(Sim(-1, 0, "پیش‌فرض", "", ""))
        }
        return out
    }

    /** تعداد بخش‌های پیامک (Persian/UCS-2: 70، GSM-7: 160) */
    fun segments(text: String): Pair<Int, Boolean> {
        if (text.isEmpty()) return 0 to true
        val gsm = isGsm7(text)
        val len = if (gsm) {
            var n = 0
            for (c in text) n += if (GSM_EXT.indexOf(c) >= 0) 2 else 1
            n
        } else text.length
        val single = if (gsm) 160 else 70
        val multi = if (gsm) 153 else 67
        val parts = if (len <= single) 1 else ((len + multi - 1) / multi)
        return parts to gsm
    }

    private const val GSM_BASIC =
        "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\u001BÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"
    private const val GSM_EXT = "^{}\\[~]|€"

    fun isGsm7(text: String): Boolean {
        for (c in text) {
            if (GSM_EXT.indexOf(c) >= 0) continue
            if (GSM_BASIC.indexOf(c) < 0) return false
        }
        return true
    }
}

/** گیرندهٔ نتیجهٔ ارسال/تحویل پیامک. */
class SmsStatusReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val token = intent.getStringExtra(Sms.EXTRA_TOKEN) ?: return
        val base = token.substringBefore("#")
        when (intent.action) {
            Sms.ACTION_SENT -> Sms.onSent(base, resultCode)
            Sms.ACTION_DELIVERED -> Sms.onDelivered(base)
        }
    }
}

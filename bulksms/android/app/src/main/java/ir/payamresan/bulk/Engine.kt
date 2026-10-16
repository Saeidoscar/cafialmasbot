package ir.payamresan.bulk

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

/**
 * موتور ارسال: صف، فاصله‌گذاری، سقف روزانه، پنجرهٔ ساعتی، توقف/ادامه و لاگ.
 * The send engine: queue, pacing, daily quota, quiet hours, pause/resume, CSV log.
 */
object Engine {

    enum class State { IDLE, RUNNING, PAUSED, WAITING_QUOTA, WAITING_WINDOW, DONE, STOPPED }

    class Settings {
        var gapMs: Long = 5_000
        var jitterMs: Long = 3_000
        var batchSize: Int = 20
        var longPauseMs: Long = 300_000
        var dailyCap: Int = 200
        var windowEnabled: Boolean = false
        var windowStartHour: Int = 9
        var windowEndHour: Int = 21
        var subId: Int = -1
        var deliveryReport: Boolean = true
        var dryRun: Boolean = false
        var autoContinueNextDay: Boolean = false
        var retryFailed: Boolean = false
    }

    var settings = Settings()
    var state: State = State.IDLE
        private set
    var report: ParseReport? = null
        private set
    var template: String = ""
    private var index = 0
    private var sentThisRun = 0
    private var sentInBatch = 0
    private val cancelFlag = AtomicBoolean(false)
    private val pauseFlag = AtomicBoolean(false)
    var lastMessage: String = "آماده"
    var startedAt: Long = 0
    var finishedAt: Long = 0

    private var thread: Thread? = null

    val contacts: List<Contact> get() = report?.contacts ?: emptyList()

    fun progress(): JSONObject {
        val c = contacts
        val done = c.count { it.status == Status.SENT || it.status == Status.DELIVERED }
        val failed = c.count { it.status == Status.FAILED }
        val o = JSONObject()
        o.put("state", state.name)
        o.put("total", c.size)
        o.put("done", done)
        o.put("failed", failed)
        o.put("remaining", c.count { it.status == Status.PENDING || it.status == Status.SENDING })
        o.put("sent_run", sentThisRun)
        o.put("sent_today", Quota.usedToday())
        o.put("daily_cap", settings.dailyCap)
        o.put("cursor", index)
        o.put("last", lastMessage)
        o.put("started_at", startedAt)
        o.put("finished_at", finishedAt)
        return o
    }

    fun load(context: Context, rep: ParseReport, text: String, st: Settings) {
        stopLoop()
        report = rep
        template = text
        settings = st
        index = 0
        sentThisRun = 0
        sentInBatch = 0
        state = State.IDLE
        lastMessage = "بارگذاری شد: ${rep.contacts.count { it.status == Status.PENDING }} مخاطب آماده ارسال"
    }

    fun start(context: Context) {
        if (report == null) { lastMessage = "هیچ فایلی بارگذاری نشده"; return }
        if (thread?.isAlive == true) { lastMessage = "ارسال در جریان است"; return }
        cancelFlag.set(false)
        pauseFlag.set(false)
        startedAt = Time.now()
        finishedAt = 0
        state = State.RUNNING
        val t = Thread { loop(context.applicationContext) }
        t.isBackground = true
        t.name = "bulk-sms-loop"
        thread = t
        t.start()
    }

    fun pause() {
        if (state == State.RUNNING) { pauseFlag.set(true); state = State.PAUSED; lastMessage = "متوقف شد (موقت)" }
    }

    fun resume() {
        if (state == State.PAUSED) { pauseFlag.set(false); state = State.RUNNING; lastMessage = "ادامه یافت" }
    }

    fun stop() {
        cancelFlag.set(true)
        pauseFlag.set(false)
        state = State.STOPPED
        lastMessage = "متوقف شد"
    }

    private fun stopLoop() {
        cancelFlag.set(true)
        val t = thread
        if (t != null && t.isAlive) { try { t.join(3000) } catch (e: Exception) {} }
        thread = null
    }

    // ------------------------------------------------------------------ loop

    private fun loop(context: Context) {
        try {
            val rep = report ?: return
            val list = rep.contacts
            while (index < list.size) {
                if (cancelFlag.get()) { state = State.STOPPED; lastMessage = "متوقف شد در مخاطب ${index + 1}"; break }
                while (pauseFlag.get() && !cancelFlag.get()) { state = State.PAUSED; sleep(500, null); state = State.RUNNING }
                if (cancelFlag.get()) continue

                val c = list[index]
                if (c.status == Status.SENT || c.status == Status.DELIVERED || c.status == Status.SKIPPED || c.status == Status.INVALID) {
                    index++; continue
                }
                if (c.status == Status.FAILED && !settings.retryFailed) { index++; continue }

                // سقف روزانه
                if (!settings.dryRun && Quota.usedToday() >= settings.dailyCap) {
                    if (settings.autoContinueNextDay) {
                        state = State.WAITING_QUOTA
                        lastMessage = "سقف روزانه پر است (${settings.dailyCap}) — ادامهٔ خودکار فردا"
                        sleepUntilNextDay()
                        if (cancelFlag.get()) break
                        continue
                    } else {
                        state = State.WAITING_QUOTA
                        lastMessage = "سقف روزانه پر شد (${settings.dailyCap} پیام در ۲۴ ساعت). فردا ادامه دهید."
                        break
                    }
                }

                // پنجرهٔ ساعتی
                if (settings.windowEnabled && !inWindow()) {
                    state = State.WAITING_WINDOW
                    lastMessage = "خارج از بازهٔ مجاز (${settings.windowStartHour}:۰۰ تا ${settings.windowEndHour}:۰۰) — در انتظار"
                    if (!sleepUntilWindow()) break
                    continue
                }

                // فاصله‌گذاری
                if (sentThisRun > 0) {
                    if (sentInBatch >= settings.batchSize) {
                        lastMessage = "استراحت طولانی بعد از ${settings.batchSize} پیام..."
                        if (!sleep(settings.longPauseMs, "استراحت")) break
                        sentInBatch = 0
                    } else {
                        val wait = settings.gapMs + (if (settings.jitterMs > 0) (0..settings.jitterMs).random() else 0)
                        lastMessage = "فاصلهٔ ${wait / 1000} ثانیه‌ای..."
                        if (!sleep(wait, null)) break
                    }
                }

                if (cancelFlag.get()) break

                val text = Templates.render(template, c, index, rep)
                c.status = Status.SENDING
                lastMessage = "ارسال به ${c.display} (${index + 1}/${list.size})"

                if (settings.dryRun) {
                    val (parts, gsm) = Sms.segments(text)
                    c.parts = parts
                    c.status = Status.SENT
                    c.sentAt = Time.now()
                    c.error = "آزمایشی"
                    sentThisRun++; sentInBatch++
                    index++
                    continue
                }

                val token = "c${c.row}-${System.currentTimeMillis()}"
                val res = Sms.sendSync(context, settings.subId, c.number!!, text, token)
                c.parts = res.parts
                c.sentAt = Time.now()
                if (res.ok) {
                    c.status = Status.SENT
                    c.error = null
                    sentThisRun++; sentInBatch++
                    Quota.add(1)
                    Log.log(context, c, text, "SENT", "")
                    lastMessage = "ارسال شد به ${c.display}"
                } else {
                    c.status = Status.FAILED
                    c.error = res.error
                    Log.log(context, c, text, "FAILED", res.error ?: "")
                    lastMessage = "خطا برای ${c.display}: ${res.error}"
                }
                index++
                saveState(context)
            }
            finishedAt = Time.now()
            if (state != State.STOPPED && state != State.PAUSED) {
                state = State.DONE
                lastMessage = "پایان. ارسال‌شده در این اجرا: $sentThisRun"
            }
        } catch (e: Throwable) {
            state = State.STOPPED
            lastMessage = "خطای غیرمنتظره: ${e.message}"
        } finally {
            thread = null
        }
    }

    private fun inWindow(): Boolean {
        val h = java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY)
        val s = settings.windowStartHour
        val e = settings.windowEndHour
        return if (s <= e) h in s until e else (h >= s || h < e)
    }

    private fun sleepUntilWindow(): Boolean {
        while (!cancelFlag.get()) {
            if (inWindow()) { state = State.RUNNING; return true }
            if (!sleep(60_000, null)) return false
        }
        return false
    }

    private fun sleepUntilNextDay(): Boolean {
        var guard = 0
        while (!cancelFlag.get() && guard < 2880) {   // حداکثر ۲۴ ساعت
            if (!sleep(30_000, null)) return false
            if (Quota.usedToday() < settings.dailyCap) { state = State.RUNNING; return true }
            if (Quota.date() != lastQuotaDate) { lastQuotaDate = Quota.date(); state = State.RUNNING; return true }
            guard++
        }
        return false
    }

    private var lastQuotaDate: String = Quota.date()

    /** خواب قابل‌لغو. true اگر کامل بخوابد، false اگر لغو شود. */
    private fun sleep(totalMs: Long, label: String?): Boolean {
        var left = totalMs
        var lastTick = Time.now()
        while (left > 0) {
            if (cancelFlag.get()) return false
            val step = minOf(left, 500L)
            try { Thread.sleep(step) } catch (e: InterruptedException) { return false }
            left -= step
            if (Time.now() - lastTick > 5000) {
                lastTick = Time.now()
                if (label != null) lastMessage = "$label — باقی‌مانده ${left / 1000} ثانیه"
            }
        }
        return true
    }

    // ------------------------------------------------------------- persistence

    fun saveState(context: Context) {
        val rep = report ?: return
        try {
            val root = JSONObject()
            root.put("cursor", index)
            root.put("template", template)
            root.put("file", rep.fileName)
            root.put("saved_at", Time.now())
            val arr = JSONArray()
            for (c in rep.contacts) arr.put(c.toJson())
            root.put("contacts", arr)
            File(context.filesDir, "campaign-state.json").writeText(root.toString())
        } catch (e: Exception) {
            // نادیده: ذخیرهٔ وضعیت حیاتی نیست
        }
    }

    fun canResume(context: Context): JSONObject? {
        val f = File(context.filesDir, "campaign-state.json")
        if (!f.exists()) return null
        return try {
            JSONObject(f.readText())
        } catch (e: Exception) { null }
    }

    fun resumeFrom(context: Context): String {
        val root = canResume(context) ?: return "وضعیت ذخیره‌شده‌ای پیدا نشد"
        val rep = ParseReport()
        rep.fileName = root.optString("file", "بازیابی‌شده")
        val arr = root.optJSONArray("contacts") ?: return "فایل وضعیت خراب است"
        val list = ArrayList<Contact>()
        for (i in 0 until arr.length()) list.add(Contact.fromJson(arr.getJSONObject(i)))
        rep.contacts = list
        rep.headers = emptyList()
        val remaining = list.count { it.status == Status.PENDING }
        load(context, rep, root.optString("template", ""), settings)
        index = 0
        return "بازیابی شد: $remaining مخاطب در انتظار از «${rep.fileName}»"
    }

    fun resetForRestart() {
        for (c in contacts) {
            if (c.status == Status.FAILED || c.status == Status.SENT || c.status == Status.SENDING) {
                c.status = Status.PENDING; c.error = null; c.parts = 0
            }
        }
        index = 0
        sentThisRun = 0
        sentInBatch = 0
    }
}

/** شمارندهٔ سقف روزانه (به تفکیک تاریخ) — Daily quota counter. */
object Quota {
    private const val FILE = "quota.json"
    private var cache: JSONObject? = null

    private fun load(context: Context): JSONObject {
        val c = cache
        if (c != null) return c
        val f = File(context.filesDir, FILE)
        val o = if (f.exists()) try { JSONObject(f.readText()) } catch (e: Exception) { JSONObject() } else JSONObject()
        cache = o
        return o
    }

    fun date(): String = Time.today()

    fun usedToday(): Int {
        val app = Ctx.app ?: return 0
        return used(app, date())
    }

    fun used(context: Context, day: String): Int {
        val o = load(context)
        return o.optInt(day, 0)
    }

    fun add(delta: Int) {
        val app = Ctx.app ?: return
        val o = load(app)
        val d = date()
        o.put(d, o.optInt(d, 0) + delta)
        try { File(app.filesDir, FILE).writeText(o.toString()) } catch (e: Exception) {}
    }

    fun set(day: String, value: Int, context: Context) {
        val o = load(context)
        o.put(day, value)
        try { File(context.filesDir, FILE).writeText(o.toString()) } catch (e: Exception) {}
    }

    /** مصرف ۱۴ روز اخیر برای نمایش در داشبورد. */
    fun history(context: Context, days: Int = 14): List<Pair<String, Int>> {
        val o = load(context)
        val fmt = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US)
        val cal = java.util.Calendar.getInstance()
        val out = ArrayList<Pair<String, Int>>()
        for (i in days - 1 downTo 0) {
            val c = cal.clone() as java.util.Calendar
            c.add(java.util.Calendar.DAY_OF_YEAR, -i)
            val key = fmt.format(c.time)
            out.add(key to o.optInt(key, 0))
        }
        return out
    }
}

/** نگه‌داشتن Context برنامه برای توابع بدون آرگومان. */
object Ctx {
    var app: Context? = null
}

/** لاگ روزانهٔ ارسال در فایل CSV با انکودینگ UTF-8 (سازگار با اکسل). */
object Log {
    fun log(context: Context, c: Contact, text: String, result: String, error: String) {
        try {
            val dir = File(context.filesDir, "logs")
            if (!dir.exists()) dir.mkdirs()
            val f = File(dir, "sent-${Quota.date()}.csv")
            val header = "time,number,name,operator,parts,result,error,message\n"
            val sb = StringBuilder()
            if (!f.exists() || f.length() == 0L) sb.append(header)
            val line = listOf(
                Time.format(Time.now()),
                c.number ?: c.rawNumber,
                c.name,
                Rules.operatorOf(c.number) ?: "",
                c.parts.toString(),
                result,
                error,
                text.replace("\n", " ").replace("\r", " ")
            ).joinToString(",") { Csv.escape(it) }
            sb.append(line).append("\r\n")
            f.appendText(sb.toString(), Charsets.UTF_8)
        } catch (e: Exception) {
            // لاگ نباید ارسال را متوقف کند
        }
    }

    fun files(context: Context): List<File> {
        val dir = File(context.filesDir, "logs")
        return if (dir.exists()) dir.listFiles()?.sortedByDescending { it.name } ?: emptyList() else emptyList()
    }
}

/** جای‌گذاری متغیرها در متن پیام — {name} {number} {group} {index} {date} و هر ستون CSV. */
object Templates {
    private val RE = Regex("\\{([a-zA-Z0-9_\\u0600-\\u06FF -]+)\\}")

    fun render(template: String, c: Contact, index: Int, rep: ParseReport): String {
        return RE.replace(template) { m ->
            val key = Rules.cleanHeader(m.groupValues[1])
            when (key) {
                "name", "نام", "نامکامل" -> c.name.ifBlank { "همراه گرامی" }
                "first_name", "نامکوچک" -> firstToken(c.name)
                "last_name", "نامخانوادگی" -> lastToken(c.name)
                "number", "شماره", "موبایل" -> c.number ?: c.rawNumber
                "index", "ردیف" -> (index + 1).toString()
                "group", "گروه" -> c.group
                "date" -> Time.today()
                "time" -> java.text.SimpleDateFormat("HH:mm", java.util.Locale.US).format(java.util.Date())
                else -> c.fields[key] ?: ""
            }
        }
    }

    private fun firstToken(s: String): String = s.trim().split(" ").firstOrNull() ?: ""
    private fun lastToken(s: String): String = s.trim().split(" ").lastOrNull() ?: ""

    /** نمونهٔ قالب‌های آماده. */
    val SAMPLES: List<Pair<String, String>> = listOf(
        "دعوت رسمی" to "{name} عزیز، سلام.\nاین پیام از طرف مجموعهٔ ما ارسال شده است.\nبا تشکر — برای لغو پاسخ دهید: لغو",
        "یادآوری" to "{name} گرامی، یادآوری می‌کنیم که وقت شما فردا ساعت ۱۷ ثبت شده است.\nلطفاً در صورت عدم امکان، پاسخ دهید.",
        "اطلاع‌رسانی ساده" to "سلام {name} جان، خبر تازه‌ای داریم که ممکن است برایتان مهم باشد.\nبرای جزئیات پاسخ دهید.",
        "متن با شماره" to "این پیام به شمارهٔ {number} فرستاده شد. (ردیف {index})"
    )
}

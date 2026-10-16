package ir.payamresan.bulk

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder

/**
 * سرویس پیش‌زمینه تا ارسال گروهی با بسته شدن صفحه یا خاموش شدن نمایشگر قطع نشود.
 * Foreground service so a bulk run survives screen-off / activity close.
 */
class SendService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        Ctx.app = applicationContext
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Ctx.app = applicationContext
        startForeground(NOTIF_ID, notification("ارسال پیامک گروهی در حال اجرا", "برای توقف، برنامه را باز کنید"))

        when (intent?.action) {
            ACTION_START -> Engine.start(applicationContext)
            ACTION_PAUSE -> Engine.pause()
            ACTION_RESUME -> Engine.resume()
            ACTION_STOP -> {
                Engine.stop()
                Engine.saveState(applicationContext)
            }
        }
        // اگر موتور متوقف شد، سرویس را ببند
        Thread {
            while (true) {
                Thread.sleep(1500)
                val s = Engine.state
                if (s != Engine.State.RUNNING && s != Engine.State.PAUSED &&
                    s != Engine.State.WAITING_QUOTA && s != Engine.State.WAITING_WINDOW
                ) break
            }
            stopSelf()
        }.start()
        return START_NOT_STICKY
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (nm.getNotificationChannel(CHANNEL) == null) {
                val ch = NotificationChannel(CHANNEL, "ارسال پیامک", NotificationManager.IMPORTANCE_LOW)
                ch.description = "وضعیت ارسال گروهی پیامک"
                nm.createNotificationChannel(ch)
            }
        }
    }

    private fun notification(title: String, text: String): Notification {
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE else PendingIntent.FLAG_UPDATE_CURRENT
        )
        val stop = PendingIntent.getService(
            this, 1, Intent(this, SendService::class.java).setAction(ACTION_STOP),
            if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE else PendingIntent.FLAG_UPDATE_CURRENT
        )
        val b = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            Notification.Builder(this, CHANNEL) else @Suppress("DEPRECATION") Notification.Builder(this)
        b.setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_dialog_email)
            .setOngoing(true)
            .setContentIntent(open)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "توقف", stop)
        return b.build()
    }

    companion object {
        const val CHANNEL = "bulk_sms"
        const val NOTIF_ID = 4711
        const val ACTION_START = "ir.payamresan.bulk.START"
        const val ACTION_PAUSE = "ir.payamresan.bulk.PAUSE"
        const val ACTION_RESUME = "ir.payamresan.bulk.RESUME"
        const val ACTION_STOP = "ir.payamresan.bulk.STOP"

        fun ctl(context: Context, action: String) {
            val i = Intent(context, SendService::class.java).setAction(action)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(i)
            else context.startService(i)
        }
    }
}

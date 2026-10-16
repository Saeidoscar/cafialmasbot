package ir.payamresan.bulk

import android.Manifest
import android.app.AlertDialog
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.*
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import java.io.File

class MainActivity : AppCompatActivity() {

    private lateinit var prefs: SharedPreferences
    private lateinit var root: LinearLayout

    // وضعیت بازیابی‌شده از پارامتر ورودی (اگر از Memory Monitor اندروید باز شده باشد)
    private var pendingTemplate: String? = null

    private val pickCsv = registerForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        if (uri != null) loadCsv(uri)
    }

    private val askPerms = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        refreshSims()
        toast("دسترسی‌ها بررسی شد")
    }

    // ------------------------------------------------------------- lifecycle

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Ctx.app = applicationContext
        prefs = getSharedPreferences("bulk", MODE_PRIVATE)
        try {
            title = "پیام‌رسان گروهی"
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                // اگر پارامتر متنی از کاربر دیگری آمده بود
                intent?.getStringExtra("template")?.let { pendingTemplate = it }
            }
        } catch (e: Exception) {}

        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(14), dp(14), dp(28))
            setBackgroundColor(Color.parseColor("#F3F5F7"))
        }
        val scroll = ScrollView(this).apply { addView(root, ViewGroup.LayoutParams(-1, -2)) }
        setContentView(scroll)

        buildUi()
        requestPermissionsIfNeeded()
        Handler(Looper.getMainLooper()).post(ticker)
        checkResume()
    }

    override fun onDestroy() {
        super.onDestroy()
        Handler(Looper.getMainLooper()).removeCallbacks(ticker)
        if (Engine.state != Engine.State.RUNNING && Engine.state != Engine.State.PAUSED) Engine.saveState(this)
    }

    // ------------------------------------------------------------------ perms

    private fun requestPermissionsIfNeeded() {
        val wanted = ArrayList<String>()
        if (checkSelfPermission(Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED) wanted.add(Manifest.permission.SEND_SMS)
        if (checkSelfPermission(Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED) wanted.add(Manifest.permission.READ_PHONE_STATE)
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            wanted.add(Manifest.permission.POST_NOTIFICATIONS)
        if (wanted.isNotEmpty()) askPerms.launch(wanted.toTypedArray())
    }

    // ---------------------------------------------------------------------- UI

    private lateinit var simSpinner: Spinner
    private lateinit var txtFile: TextView
    private lateinit var txtReport: TextView
    private lateinit var txtPreview: TextView
    private lateinit var edtTemplate: EditText
    private lateinit var progressBar: ProgressBar
    private lateinit var txtProgress: TextView
    private lateinit var txtLive: TextView
    private lateinit var txtQuota: TextView
    private lateinit var txtBridge: TextView
    private lateinit var edtGap: EditText
    private lateinit var edtJitter: EditText
    private lateinit var edtBatch: EditText
    private lateinit var edtPause: EditText
    private lateinit var edtCap: EditText
    private lateinit var chkWindow: CheckBox
    private lateinit var edtWindowStart: EditText
    private lateinit var edtWindowEnd: EditText
    private lateinit var chkDry: CheckBox
    private lateinit var chkAutoNextDay: CheckBox
    private lateinit var chkRetry: CheckBox
    private lateinit var spinSamples: Spinner

    private fun buildUi() {
        // ---------- سربرگ
        root.addView(bigTitle("پیام‌رسان گروهی (CSV → پیامک)"))
        root.addView(small("نسخهٔ ${BuildConfig.VERSION_NAME} • ${Rules.VERSION} • ارسال با سیم‌کارت گوشی"))

        txtQuota = small("سقف امروز: —")
        root.addView(txtQuota)

        // ---------- کارت ۱: فایل
        val c1 = card("۱) فایل مخاطبین (CSV)")
        val rowFile = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        rowFile.addView(button("انتخاب فایل CSV") { pickCsv.launch("*/*") })
        rowFile.addView(space(8))
        rowFile.addView(button("فایل نمونه") { writeSampleAndOpen() }, weight = 1f)
        c1.addView(rowFile)
        txtFile = small("فایلی انتخاب نشده است.")
        c1.addView(txtFile)
        txtReport = small("")
        c1.addView(txtReport)
        val rowReport = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        rowReport.addView(button("ذخیرهٔ خطاها (CSV)") { saveInvalid() }, weight = 1f)
        rowReport.addView(space(6))
        rowReport.addView(button("ذخیرهٔ لیست تمیز") { saveClean() }, weight = 1f)
        c1.addView(rowReport)
        c1.addView(small("قوانین ستون‌ها: شماره → number | phone | mobile | tel | msisdn | شماره | موبایل | تلفن همراه\n" +
            "نام → name | full_name | نام | نام کامل | نام و نام خانوادگی (یا first_name/last_name)"))
        root.addView(c1)

        // ---------- کارت ۲: متن پیام
        val c2 = card("۲) متن پیام")
        spinSamples = Spinner(this)
        val sampleNames = ArrayList<String>().apply { add("— قالب آماده انتخاب کنید —"); Templates.SAMPLES.forEach { add(it.first) } }
        spinSamples.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, sampleNames)
        spinSamples.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                if (position > 0) edtTemplate.setText(Templates.SAMPLES[position - 1].second)
            }
            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }
        c2.addView(spinSamples)
        edtTemplate = EditText(this).apply {
            setText(prefs.getString("template", Templates.SAMPLES[0].second) ?: "")
            minLines = 4
            gravity = Gravity.TOP or Gravity.START
            textSize = 16f
            hint = "متن پیام… می‌توانید از {name} {number} {group} {index} استفاده کنید"
        }
        c2.addView(edtTemplate)
        val rowTokens = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        rowTokens.addView(button("درج {name}") { insert("{name}") }, weight = 1f)
        rowTokens.addView(space(6))
        rowTokens.addView(button("درج {number}") { insert("{number}") }, weight = 1f)
        c2.addView(rowTokens)
        txtPreview = small("پیش‌نمایش: —")
        c2.addView(txtPreview)
        root.addView(c2)

        // ---------- کارت ۳: تنظیمات
        val c3 = card("۳) تنظیمات ایمنی و سرعت")
        val rowSim = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        rowSim.addView(textLabel("سیم‌کارت ارسال:"))
        simSpinner = Spinner(this)
        rowSim.addView(simSpinner, LinearLayout.LayoutParams(0, -2, 1f))
        c3.addView(rowSim)

        val g = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        edtGap = numField("فاصلهٔ ارسال (ثانیه)", prefs.getInt("gap", 5).toString())
        edtJitter = numField("نوسان (ثانیه)", prefs.getInt("jitter", 3).toString())
        g.addView(wrap(edtGap, "فاصلهٔ ارسال (ثانیه)"), weight = 1f)
        g.addView(space(6))
        g.addView(wrap(edtJitter, "نوسان تصادفی (ثانیه)"), weight = 1f)
        c3.addView(g)

        val g2 = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        edtBatch = numField("تعداد هر دسته", prefs.getInt("batch", 20).toString())
        edtPause = numField("استراحت (ثانیه)", prefs.getInt("pause", 300).toString())
        g2.addView(wrap(edtBatch, "تعداد هر دسته"), weight = 1f)
        g2.addView(space(6))
        g2.addView(wrap(edtPause, "استراحت بین دسته‌ها (ثانیه)"), weight = 1f)
        c3.addView(g2)

        edtCap = numField("سقف روزانه", prefs.getInt("cap", 200).toString())
        c3.addView(wrap(edtCap, "سقف پیام در ۲۴ ساعت (اپراتور ایران: ۲۰۰ تا ۵۰۰)"))

        chkWindow = CheckBox(this).apply {
            text = "فقط در بازهٔ ساعتی مشخص ارسال کن"
            isChecked = prefs.getBoolean("window", false)
        }
        c3.addView(chkWindow)
        val g3 = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        edtWindowStart = numField("از ساعت", prefs.getInt("wstart", 9).toString())
        edtWindowEnd = numField("تا ساعت", prefs.getInt("wend", 21).toString())
        g3.addView(wrap(edtWindowStart, "از ساعت"), weight = 1f)
        g3.addView(space(6))
        g3.addView(wrap(edtWindowEnd, "تا ساعت"), weight = 1f)
        c3.addView(g3)

        chkDry = CheckBox(this).apply { text = "حالت آزمایشی (بدون ارسال واقعی)"; isChecked = false }
        chkAutoNextDay = CheckBox(this).apply { text = "پس از پر شدن سقف روزانه، خودکار فردا ادامه بده"; isChecked = false }
        chkRetry = CheckBox(this).apply { text = "تلاش دوباره برای مخاطبین خطادار"; isChecked = false }
        c3.addView(chkDry); c3.addView(chkAutoNextDay); c3.addView(chkRetry)
        c3.addView(button("ذخیرهٔ تنظیمات") { saveSettings(); toast("ذخیره شد") })
        root.addView(c3)

        // ---------- کارت ۴: ارسال
        val c4 = card("۴) ارسال")
        val rowSend = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        rowSend.addView(button("▶ شروع ارسال") { saveSettings(); startSend() }, weight = 1f)
        rowSend.addView(space(6))
        rowSend.addView(button("⏸ توقف موقت") { if (Engine.state == Engine.State.PAUSED) Engine.resume() else Engine.pause() }, weight = 1f)
        c4.addView(rowSend)
        val rowSend2 = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        rowSend2.addView(button("■ توقف کامل") {
            Engine.stop(); Engine.saveState(this); stopService(android.content.Intent(this, SendService::class.java)); toast("متوقف شد")
        }, weight = 1f)
        rowSend2.addView(space(6))
        rowSend2.addView(button("↺ بازنشانی وضعیت‌ها") { Engine.resetForRestart(); toast("همه به «در انتظار» برگشت") }, weight = 1f)
        c4.addView(rowSend2)
        progressBar = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply { max = 100; progress = 0 }
        c4.addView(progressBar)
        txtProgress = small("وضعیت: آماده")
        c4.addView(txtProgress)
        txtLive = small("")
        c4.addView(txtLive)
        root.addView(c4)

        // ---------- کارت ۵: پل ارتباطی با ویندوز
        val c5 = card("۵) اتصال به برنامهٔ ویندوز (اختیاری)")
        val rowBridge = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        rowBridge.addView(button("روشن کردن پل") { startBridge() }, weight = 1f)
        rowBridge.addView(space(6))
        rowBridge.addView(button("خاموش کردن") { Bridge.stop(); txtBridge.text = "پل خاموش است." }, weight = 1f)
        c5.addView(rowBridge)
        txtBridge = small("پل خاموش است.")
        c5.addView(txtBridge)
        c5.addView(small("با روشن بودن پل، برنامهٔ ویندوز می‌تواند فایل CSV را تحلیل و ارسال را مدیریت کند. " +
            "گوشی و کامپیوتر باید به یک وای‌فای باشند."))
        root.addView(c5)

        root.addView(small("• ارسال پیامک فقط با سیم‌کارت واقعی گوشی انجام می‌شود (بدون سرویس ابری).\n" +
            "• مسئولیت محتوای پیام و رضایت گیرندگان بر عهدهٔ کاربر است."))
    }

    // -------------------------------------------------------------- ui helpers

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()
    private fun space(v: Int) = View(this).apply { layoutParams = LinearLayout.LayoutParams(dp(v), 1) }
    private fun bigTitle(t: String) = TextView(this).apply {
        text = t; textSize = 20f; setTypeface(null, Typeface.BOLD); setTextColor(Color.parseColor("#0F2A43")); gravity = Gravity.START
    }
    private fun small(t: String) = TextView(this).apply {
        text = t; textSize = 13f; setTextColor(Color.parseColor("#41546B")); setPadding(0, dp(6), 0, dp(6))
    }
    private fun textLabel(t: String) = TextView(this).apply { text = t; textSize = 14f; setPadding(0, 0, dp(8), 0) }

    private fun card(title: String): LinearLayout {
        val c = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(12), dp(10), dp(12), dp(12))
            background = GradientDrawable().apply {
                cornerRadius = dp(14).toFloat()
                setColor(Color.WHITE)
                setStroke(dp(1), Color.parseColor("#DCE3EA"))
            }
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(10) }
        }
        c.addView(TextView(this).apply {
            text = title; textSize = 16f; setTypeface(null, Typeface.BOLD); setTextColor(Color.parseColor("#123B5C")); setPadding(0, 0, 0, dp(6))
        })
        return c
    }

    private fun button(t: String, onClick: () -> Unit) = Button(this).apply {
        text = t; textSize = 13f; isAllCaps = false
        setOnClickListener { onClick() }
    }

    private fun View.addViewTo(parent: LinearLayout, weight: Float) {
        parent.addView(this, LinearLayout.LayoutParams(0, -2, weight))
    }

    private fun LinearLayout.addView(v: View, weight: Float) = v.addViewTo(this, weight)

    private fun wrap(field: EditText, label: String): LinearLayout {
        val l = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        l.addView(TextView(this).apply { text = label; textSize = 12f; setTextColor(Color.parseColor("#5A6B7C")) })
        l.addView(field)
        return l
    }

    private fun numField(hint: String, value: String) = EditText(this).apply {
        inputType = InputType.TYPE_CLASS_NUMBER
        setText(value)
        this.hint = hint
        textSize = 15f
    }

    private fun insert(t: String) {
        val s = edtTemplate.selectionStart.coerceAtLeast(0)
        edtTemplate.text.insert(s, t)
    }

    private fun toast(m: String) = Toast.makeText(this, m, Toast.LENGTH_SHORT).show()

    // ------------------------------------------------------------------ actions

    private fun checkResume() {
        val st = Engine.canResume(this)
        if (st != null) {
            val remaining = try {
                val arr = st.optJSONArray("contacts")
                var n = 0
                if (arr != null) for (i in 0 until arr.length()) if (arr.getJSONObject(i).optString("status") == "PENDING") n++
                n
            } catch (e: Exception) { 0 }
            if (remaining > 0) {
                AlertDialog.Builder(this)
                    .setTitle("ادامهٔ ارسال قبلی؟")
                    .setMessage("یک صف ذخیره‌شده با $remaining مخاطب در انتظار وجود دارد.\nبازیابی شود؟")
                    .setPositiveButton("بله") { _, _ ->
                        val msg = Engine.resumeFrom(this)
                        txtFile.text = msg
                        val rep = Engine.report
                        if (rep != null) { txtReport.text = summaryText(rep); edtTemplate.setText(Engine.template) }
                    }
                    .setNegativeButton("خیر", null)
                    .show()
            }
        }
    }

    private fun loadCsv(uri: Uri) {
        try {
            val input = contentResolver.openInputStream(uri) ?: throw IllegalArgumentException("فایل باز نشد")
            val name = uri.lastPathSegment ?: "contacts.csv"
            val table = input.use { Csv.read(it) }
            val s = loadSettings()
            val rep = Contacts.analyze(table, name.substringAfterLast('/'), strictProvider = false, blacklist = blacklist())
            Engine.load(this, rep, edtTemplate.text.toString(), s)
            txtFile.text = "فایل: ${rep.fileName}\nردیف‌ها: ${rep.totalRows} • جداکننده: «${rep.delimiter}» • انکودینگ: ${rep.encoding}"
            txtReport.text = summaryText(rep)
            updatePreview()
            toast("تحلیل شد: ${rep.contacts.count { it.status == Status.PENDING }} مخاطب آماده")
        } catch (e: Exception) {
            AlertDialog.Builder(this).setTitle("خطا در خواندن فایل").setMessage(e.message ?: "نامشخص").setPositiveButton("باشه", null).show()
        }
    }

    private fun summaryText(rep: ParseReport): String {
        val sb = StringBuilder()
        sb.append("ستون شماره: ${rep.numberColumn ?: "—"}   |   ستون نام: ${rep.nameColumn ?: "—"}\n")
        sb.append("معتبر: ${rep.contacts.count { it.status == Status.PENDING }}")
        if (rep.contacts.any { it.status == Status.SKIPPED }) sb.append("  |  کنارگذاشته: ${rep.contacts.count { it.status == Status.SKIPPED }}")
        sb.append("  |  نامعتبر: ${rep.invalid.size}  |  تکراری: ${rep.duplicates}  |  ردیف ردشده: ${rep.skippedRows}")
        if (rep.invalid.isNotEmpty()) {
            sb.append("\nنمونهٔ خطاها:")
            rep.invalid.take(5).forEach { sb.append("\n  سطر ${it.row}: «${it.rawNumber}» — ${it.reason}") }
        }
        if (rep.warnings.isNotEmpty()) {
            sb.append("\nهشدارها:")
            rep.warnings.take(4).forEach { sb.append("\n  • $it") }
        }
        return sb.toString()
    }

    private fun writeSampleAndOpen() {
        try {
            val f = File(getExternalFilesDir(null) ?: filesDir, "sample-contacts.csv")
            f.writeText(
                "name,number,group,delay_ms\n" +
                    "علی رضایی,09121234567,مشتری,5000\n" +
                    "مریم حسینی,09351234568,همکار,5000\n" +
                    "محمد کریمی,+989121234569,دوست,\n" +
                    "سارا محمدی,۰۹۱۹۱۲۳۴۵۶۷,,\n"
            )
            AlertDialog.Builder(this)
                .setTitle("فایل نمونه ساخته شد")
                .setMessage("مسیر:\n${f.absolutePath}\n\nهمین فایل را با «انتخاب فایل CSV» باز کنید.")
                .setPositiveButton("باشه", null).show()
        } catch (e: Exception) {
            toast("خطا: ${e.message}")
        }
    }

    private fun saveInvalid() {
        val rep = Engine.report ?: run { toast("اول یک فایل انتخاب کنید"); return }
        shareText(Contacts.invalidToCsv(rep), "invalid-rows.csv")
    }

    private fun saveClean() {
        val rep = Engine.report ?: run { toast("اول یک فایل انتخاب کنید"); return }
        shareText(Contacts.contactsToCsv(rep.contacts), "clean-contacts.csv")
    }

    private fun shareText(content: String, fileName: String) {
        try {
            val dir = File(getExternalFilesDir(null) ?: filesDir, "out")
            if (!dir.exists()) dir.mkdirs()
            val f = File(dir, fileName)
            f.writeText(content, Charsets.UTF_8)
            val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", f)
            val i = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
                type = "text/csv"
                putExtra(android.content.Intent.EXTRA_STREAM, uri)
                addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            startActivity(android.content.Intent.createChooser(i, "ذخیره/اشتراک فایل"))
            toast("فایل ساخته شد: ${f.absolutePath}")
        } catch (e: Exception) {
            toast("خطا: ${e.message}")
        }
    }

    private fun blacklist(): Set<String> {
        val f = File(filesDir, "blacklist.txt")
        if (!f.exists()) return emptySet()
        return f.readLines().mapNotNull { Rules.normalizeNumber(it) }.toSet()
    }

    private fun loadSettings(): Engine.Settings {
        val s = Engine.Settings()
        s.gapMs = (prefs.getInt("gap", 5).toLong()) * 1000
        s.jitterMs = (prefs.getInt("jitter", 3).toLong()) * 1000
        s.batchSize = prefs.getInt("batch", 20).coerceAtLeast(1)
        s.longPauseMs = prefs.getInt("pause", 300).toLong() * 1000
        s.dailyCap = prefs.getInt("cap", 200).coerceIn(1, 5000)
        s.windowEnabled = prefs.getBoolean("window", false)
        s.windowStartHour = prefs.getInt("wstart", 9).coerceIn(0, 23)
        s.windowEndHour = prefs.getInt("wend", 21).coerceIn(1, 24)
        s.deliveryReport = prefs.getBoolean("delivery", true)
        s.subId = prefs.getInt("subId", -1)
        return s
    }

    private fun saveSettings() {
        prefs.edit()
            .putString("template", edtTemplate.text.toString())
            .putInt("gap", edtGap.text.toString().toIntOrNull() ?: 5)
            .putInt("jitter", edtJitter.text.toString().toIntOrNull() ?: 3)
            .putInt("batch", edtBatch.text.toString().toIntOrNull() ?: 20)
            .putInt("pause", edtPause.text.toString().toIntOrNull() ?: 300)
            .putInt("cap", edtCap.text.toString().toIntOrNull() ?: 200)
            .putBoolean("window", chkWindow.isChecked)
            .putInt("wstart", edtWindowStart.text.toString().toIntOrNull() ?: 9)
            .putInt("wend", edtWindowEnd.text.toString().toIntOrNull() ?: 21)
            .putBoolean("delivery", true)
            .apply()
    }

    private var sims: List<Sms.Sim> = emptyList()

    private fun refreshSims() {
        sims = Sms.sims(this)
        val names = sims.map { s ->
            val extra = if (s.carrier.isNotBlank()) " (${s.carrier})" else ""
            "سیم ${s.slot + 1}: ${s.name}$extra"
        }
        simSpinner.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, names)
        val saved = prefs.getInt("subId", -1)
        val pos = sims.indexOfFirst { it.subId == saved }
        if (pos >= 0) simSpinner.setSelection(pos)
        simSpinner.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                if (position < sims.size) prefs.edit().putInt("subId", sims[position].subId).apply()
            }
            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }
    }

    private fun updatePreview() {
        val rep = Engine.report
        val tpl = edtTemplate.text.toString()
        if (tpl.isBlank()) { txtPreview.text = "پیش‌نمایش: —"; return }
        val sample = rep?.contacts?.firstOrNull()
            ?: Contact(0, "09121234567", "09121234567", "نمونه", "", null)
        val text = Templates.render(tpl, sample, 0, rep ?: ParseReport())
        val (parts, gsm) = Sms.segments(text)
        val enc = if (gsm) "GSM-7 (لاتین)" else "یونیکد (فارسی/غیرلاتین)"
        txtPreview.text = "پیش‌نمایش (برای «${sample.display}»):\n$text\n\n" +
            "طول: ${text.length} کاراکتر • تعداد پیامک: $parts • کدگذاری: $enc"
    }

    private fun startSend() {
        if (checkSelfPermission(Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED) {
            toast("اول دسترسی ارسال پیامک را بدهید"); requestPermissionsIfNeeded(); return
        }
        val rep = Engine.report
        if (rep == null) { toast("اول فایل CSV را انتخاب کنید"); return }
        val pending = rep.contacts.count { it.status == Status.PENDING }
        if (pending == 0) { toast("مخاطب در انتظاری وجود ندارد"); return }
        if (edtTemplate.text.isBlank()) { toast("متن پیام خالی است"); return }

        val s = loadSettings()
        s.subId = sims.getOrNull(simSpinner.selectedItemPosition)?.subId ?: -1
        s.dryRun = chkDry.isChecked
        s.autoContinueNextDay = chkAutoNextDay.isChecked
        s.retryFailed = chkRetry.isChecked
        Engine.load(this, rep, edtTemplate.text.toString(), s)

        val capLeft = s.dailyCap - Quota.usedToday()
        val est = estMinutes(pending.coerceAtMost(capLeft.coerceAtLeast(0)), s)
        AlertDialog.Builder(this)
            .setTitle("شروع ارسال گروهی")
            .setMessage(
                "مخاطب در انتظار: $pending\n" +
                    "سقف امروز: ${s.dailyCap} (مصرف‌شده: ${Quota.usedToday()} → باقی‌مانده: ${capLeft.coerceAtLeast(0)})\n" +
                    "فاصلهٔ ارسال: ${s.gapMs / 1000} ثانیه (−${s.jitterMs / 1000}+ نوسان) • هر ${s.batchSize} پیام یک استراحت ${s.longPauseMs / 1000} ثانیه‌ای\n" +
                    (if (s.dryRun) "\nحالت آزمایشی فعال است — هیچ پیامکی ارسال نمی‌شود.\n" else "\nزمان تقریبی این اجرا: $est\n") +
                    "\nادامه می‌دهید؟"
            )
            .setPositiveButton("شروع") { _, _ ->
                Engine.start(this)
                SendService.ctl(this, SendService.ACTION_START)
                toast("ارسال آغاز شد")
            }
            .setNegativeButton("لغو", null)
            .show()
    }

    private fun estMinutes(count: Int, s: Engine.Settings): String {
        if (count <= 0) return "—"
        val perMsg = (s.gapMs + s.jitterMs / 2) / 1000.0
        val batches = count / s.batchSize
        val secs = count * perMsg + batches * (s.longPauseMs / 1000.0)
        return if (secs < 3600) "${(secs / 60).toInt()} دقیقه" else "${"%.1f".format(secs / 3600)} ساعت"
    }

    private fun startBridge() {
        try {
            val port = prefs.getInt("bridgePort", 8765)
            val r = Bridge.start(applicationContext, port)
            txtBridge.text = r
        } catch (e: Exception) {
            txtBridge.text = "خطا: ${e.message}"
        }
    }

    // ----------------------------------------------------------------- ticker

    private val ticker = object : Runnable {
        override fun run() {
            try {
                txtQuota.text = "سقف امروز (${Quota.date()}): ${Quota.usedToday()} پیام ارسال‌شده"
                val p = Engine.progress()
                val total = p.optInt("total")
                val done = p.optInt("done")
                val failed = p.optInt("failed")
                progressBar.max = if (total > 0) total else 100
                progressBar.progress = done
                txtProgress.text = "وضعیت: ${stateFa(p.optString("state"))} • ${Engine.lastMessage}\n" +
                    "ارسال‌شده: $done از $total • خطا: $failed • این اجرا: ${p.optInt("sent_run")} • امروز: ${p.optInt("sent_today")}"
                val list = Engine.contacts
                if (list.isNotEmpty()) {
                    val tail = list.takeLast(400).filter { it.status != Status.PENDING }.takeLast(8)
                    txtLive.text = if (tail.isEmpty()) "" else
                        "آخرین وضعیت‌ها:\n" + tail.joinToString("\n") { c ->
                            "• ${c.number} ${c.name} → ${c.status.label}${if (c.error != null && c.error!!.isNotBlank()) " (" + c.error + ")" else ""}"
                        }
                }
                updatePreview()
            } catch (e: Exception) {
            }
            Handler(Looper.getMainLooper()).postDelayed(this, 1200)
        }
    }

    private fun stateFa(s: String): String = when (s) {
        "IDLE" -> "آماده"
        "RUNNING" -> "در حال ارسال"
        "PAUSED" -> "توقف موقت"
        "WAITING_QUOTA" -> "انتظار برای سقف روزانه"
        "WAITING_WINDOW" -> "انتظار برای بازهٔ ساعتی"
        "DONE" -> "پایان یافت"
        "STOPPED" -> "متوقف شده"
        else -> s
    }
}

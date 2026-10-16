package ir.payamresan.bulk

import android.content.Context
import android.database.Cursor
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * امتدادهای پل HTTP: قوانین، تحلیل CSV، و صف ارسال.
 * Bridge endpoints for rules / CSV analysis / send queue.
 */

/** قوانین را به‌صورت JSON می‌دهد تا اپ ویندوز دقیقاً همان قوانین را رعایت کند. */
fun Rules.rulesJson(): JSONObject {
    fun arr(l: List<String>) = JSONArray().apply { l.forEach { put(it) } }
    val ops = JSONObject()
    for ((name, prefixes) in OPERATORS) ops.put(name, arr(prefixes))
    return JSONObject()
        .put("version", VERSION)
        .put("number_headers", arr(NUMBER_HEADERS))
        .put("name_headers", arr(NAME_HEADERS))
        .put("first_headers", arr(FIRST_HEADERS))
        .put("last_headers", arr(LAST_HEADERS))
        .put("skip_headers", arr(SKIP_HEADERS))
        .put("delay_headers", arr(DELAY_HEADERS))
        .put("group_headers", arr(GROUP_HEADERS))
        .put("provider_headers", arr(PROVIDER_HEADERS))
        .put("operators", ops)
        .put("placeholders", arr(BUILTIN_PLACEHOLDERS))
        .put("fake_numbers", arr(FAKE_NUMBERS.toList()))
        .put("max_daily_default", 200)
}

/** POST /parse — تحلیل فایل CSV ارسالی از کامپیوتر. */
fun Rules.handleParse(context: Context, body: ByteArray): JSONObject {
    try {
        val req = JSONObject(String(body, Charsets.UTF_8))
        val name = req.optString("file_name", "contacts.csv")
        val strict = req.optBoolean("strict_provider", false)
        val table: Csv.Table = when {
            req.has("csv_text") -> Csv.parse(req.getString("csv_text"), "UTF-8")
            req.has("csv_base64") -> {
                val bytes = android.util.Base64.decode(req.getString("csv_base64"), android.util.Base64.DEFAULT)
                val (text, enc) = Csv.decode(bytes)
                Csv.parse(text, enc)
            }
            else -> return JSONObject().put("ok", false).put("error", "csv_text یا csv_base64 لازم است")
        }
        val rep = Contacts.analyze(table, name, strict, blacklist(context))
        // نگه‌داشتن برای ارسال
        Engine.load(context, rep, Engine.template.ifBlank { Templates.SAMPLES[0].second }, Engine.settings)
        return Contacts.reportToJson(rep, false)
            .put("ok", true)
            .put("placeholders", JSONArray(Contacts.placeholderTokens(rep).map { "{" + it + "}" }))
    } catch (e: Exception) {
        return JSONObject().put("ok", false).put("error", e.message ?: e.javaClass.simpleName)
    }
}

/**
 * POST /send — پیکربندی صف از سمت کامپیوتر.
 * body: {
 *   file_name?: string,
 *   csv_text? | contacts?: [{number,name,group,delay_ms}],
 *   template: string,
 *   settings: { gap_ms, jitter_ms, batch_size, long_pause_ms, daily_cap,
 *               window:{enabled,start_hour,end_hour}, sub_id, dry_run,
 *               auto_continue_next_day, retry_failed },
 *   action: "load" | "start" | "pause" | "resume" | "stop" | "dry_run_preview"
 * }
 */
fun Rules.handleSend(context: Context, body: ByteArray): JSONObject {
    try {
        val req = JSONObject(String(body, Charsets.UTF_8))
        val action = req.optString("action", "load").lowercase()

        if (req.has("settings")) {
            val s = req.getJSONObject("settings")
            val st = Engine.settings
            st.gapMs = s.optLong("gap_ms", st.gapMs)
            st.jitterMs = s.optLong("jitter_ms", st.jitterMs)
            st.batchSize = s.optInt("batch_size", st.batchSize)
            st.longPauseMs = s.optLong("long_pause_ms", st.longPauseMs)
            st.dailyCap = s.optInt("daily_cap", st.dailyCap)
            st.subId = s.optInt("sub_id", st.subId)
            st.deliveryReport = s.optBoolean("delivery_report", st.deliveryReport)
            st.dryRun = s.optBoolean("dry_run", st.dryRun)
            st.autoContinueNextDay = s.optBoolean("auto_continue_next_day", st.autoContinueNextDay)
            st.retryFailed = s.optBoolean("retry_failed", st.retryFailed)
            val w = s.optJSONObject("window")
            if (w != null) {
                st.windowEnabled = w.optBoolean("enabled", st.windowEnabled)
                st.windowStartHour = w.optInt("start_hour", st.windowStartHour)
                st.windowEndHour = w.optInt("end_hour", st.windowEndHour)
            }
        }

        val template = req.optString("template", Engine.template)

        if (req.has("contacts") || req.has("csv_text") || req.has("csv_base64")) {
            val rep: ParseReport
            if (req.has("contacts")) {
                rep = ParseReport()
                rep.fileName = req.optString("file_name", "از کامپیوتر")
                val arr = req.getJSONArray("contacts")
                val seen = HashSet<String>()
                for (i in 0 until arr.length()) {
                    val o = arr.getJSONObject(i)
                    val raw = o.optString("number", "")
                    val num = Rules.normalizeNumber(raw)
                    val problem = Rules.numberProblem(raw, num)
                    if (problem != null) { rep.invalid.add(InvalidRow(i + 2, raw, problem)); continue }
                    if (!seen.add(num!!)) { rep.duplicates++; continue }
                    val fields = HashMap<String, String>()
                    for (k in o.keys()) fields[Rules.cleanHeader(k)] = o.optString(k, "")
                    rep.contacts.add(
                        Contact(
                            row = i + 2,
                            rawNumber = raw,
                            number = num,
                            name = o.optString("name", ""),
                            group = o.optString("group", ""),
                            delayMs = if (o.has("delay_ms")) o.optLong("delay_ms") else null,
                            fields = fields
                        )
                    )
                }
            } else {
                val table = if (req.has("csv_text")) Csv.parse(req.getString("csv_text"), "UTF-8")
                else {
                    val bytes = android.util.Base64.decode(req.getString("csv_base64"), android.util.Base64.DEFAULT)
                    val (text, enc) = Csv.decode(bytes)
                    Csv.parse(text, enc)
                }
                rep = Contacts.analyze(table, req.optString("file_name", "contacts.csv"), false, blacklist(context))
            }
            Engine.load(context, rep, template, Engine.settings)
        } else if (template.isNotBlank()) {
            Engine.template = template
        }

        when (action) {
            "start" -> { Engine.start(context); SendService.ctl(context, SendService.ACTION_START) }
            "pause" -> Engine.pause()
            "resume" -> Engine.resume()
            "stop" -> { Engine.stop(); Engine.saveState(context) }
            "reset" -> Engine.resetForRestart()
            "load" -> {}
        }
        val p = Engine.progress()
        p.put("ok", true)
        p.put("preview", if (Engine.report != null) previewOf(context) else JSONObject.NULL)
        return p
    } catch (e: Exception) {
        return JSONObject().put("ok", false).put("error", e.message ?: e.javaClass.simpleName)
    }
}

private fun previewOf(context: Context): JSONObject {
    val rep = Engine.report ?: return JSONObject()
    val sample = rep.contacts.firstOrNull()
    val text = if (sample != null) Templates.render(Engine.template, sample, 0, rep) else ""
    val (parts, gsm) = Sms.segments(text)
    return JSONObject()
        .put("sample_number", sample?.number ?: "")
        .put("sample_name", sample?.name ?: "")
        .put("text", text)
        .put("chars", text.length)
        .put("parts", parts)
        .put("encoding", if (gsm) "GSM-7" else "UCS-2")
}

fun blacklist(context: Context): Set<String> {
    val f = File(context.filesDir, "blacklist.txt")
    if (!f.exists()) return emptySet()
    return f.readLines().mapNotNull { Rules.normalizeNumber(it) }.toSet()
}

fun addToBlacklist(context: Context, number: String) {
    val n = Rules.normalizeNumber(number) ?: return
    val f = File(context.filesDir, "blacklist.txt")
    val cur = if (f.exists()) f.readText() else ""
    if (!cur.lines().mapNotNull { Rules.normalizeNumber(it) }.contains(n)) {
        f.appendText(n + "\n")
    }
}

/**
 * صندوق ورودی پیامک: گزارش «لغو/STOP» را تشخیص می‌دهد و شماره را در لیست سیاه می‌گذارد.
 * Reads the SMS inbox, detects opt-out replies, and updates the blacklist.
 */
object Inbox {

    private val OPTOUT = listOf("لغو", "لغو11", "لغو ۱۱", "stop", "unsubscribe", "cancel", "حذف", "دیگر پیام")

    fun read(context: Context, limit: Int): JSONArray {
        val arr = JSONArray()
        val uri = Uri.parse("content://sms/inbox")
        var cur: Cursor? = null
        try {
            cur = context.contentResolver.query(
                uri,
                arrayOf("address", "body", "date", "person"),
                null, null, "date DESC"
            )
            while (cur != null && cur.moveToNext() && arr.length() < limit) {
                val address = cur.getString(0) ?: ""
                val body = cur.getString(1) ?: ""
                val date = cur.getLong(2)
                val num = Rules.normalizeNumber(address)
                arr.put(
                    JSONObject()
                        .put("number", num ?: address)
                        .put("body", body)
                        .put("date", date)
                        .put("time", Time.format(date))
                        .put("opt_out", isOptOut(body))
                )
            }
        } catch (e: Exception) {
            arr.put(JSONObject().put("error", "خواندن صندوق ورودی ممکن نیست: ${e.message}"))
        } finally {
            try { cur?.close() } catch (e: Exception) {}
        }
        return arr
    }

    fun json(context: Context, limit: Int): JSONObject = JSONObject().put("messages", read(context, limit))

    fun isOptOut(body: String): Boolean {
        val b = body.trim().lowercase()
        return OPTOUT.any { b.contains(it) }
    }

    /** شماره‌هایی که درخواست لغو داده‌اند را به لیست سیاه اضافه می‌کند. */
    fun applyOptOuts(context: Context, limit: Int = 500): Int {
        val arr = read(context, limit)
        var n = 0
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            if (o.optBoolean("opt_out", false)) {
                val num = o.optString("number", "")
                if (Rules.isValidIranMobile(num)) { addToBlacklist(context, num); n++ }
            }
        }
        return n
    }
}

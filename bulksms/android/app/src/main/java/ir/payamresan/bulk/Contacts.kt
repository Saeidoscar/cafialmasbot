package ir.payamresan.bulk

import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** وضعیت هر مخاطب در صف ارسال. */
enum class Status(val label: String) {
    PENDING("در انتظار"),
    SENDING("در حال ارسال"),
    SENT("ارسال شد"),
    DELIVERED("تحویل شد"),
    FAILED("خطا"),
    SKIPPED("رد شد"),
    INVALID("نامعتبر"),
}

class Contact(
    val row: Int,
    val rawNumber: String,
    val number: String?,          // نرمال‌شده: 09XXXXXXXXX یا null
    val name: String,
    val group: String,
    val delayMs: Long?,
    var fields: Map<String, String> = emptyMap(),
    var status: Status = Status.PENDING,
    var parts: Int = 0,
    var error: String? = null,
    var sentAt: Long = 0L
) {
    val display: String get() = if (name.isNotBlank()) name else (number ?: rawNumber)

    fun toJson(): JSONObject {
        val o = JSONObject()
        o.put("row", row)
        o.put("raw", rawNumber)
        o.put("number", number ?: JSONObject.NULL)
        o.put("name", name)
        o.put("group", group)
        if (delayMs != null) o.put("delayMs", delayMs)
        o.put("status", status.name)
        o.put("parts", parts)
        if (error != null) o.put("error", error)
        o.put("sentAt", sentAt)
        return o
    }

    companion object {
        fun fromJson(o: JSONObject): Contact {
            val c = Contact(
                row = o.optInt("row"),
                rawNumber = o.optString("raw", ""),
                number = if (o.isNull("number")) null else o.optString("number"),
                name = o.optString("name", ""),
                group = o.optString("group", ""),
                delayMs = if (o.has("delayMs")) o.optLong("delayMs") else null
            )
            c.status = try { Status.valueOf(o.optString("status", "PENDING")) } catch (e: Exception) { Status.PENDING }
            c.parts = o.optInt("parts", 0)
            c.error = if (o.has("error") && !o.isNull("error")) o.optString("error") else null
            c.sentAt = o.optLong("sentAt", 0L)
            return c
        }
    }
}

class InvalidRow(val row: Int, val rawNumber: String, val reason: String)

/** نتیجهٔ تحلیل یک فایل CSV. */
class ParseReport {
    var fileName: String = ""
    var encoding: String = "UTF-8"
    var delimiter: Char = ','
    var headers: List<String> = emptyList()
    var numberColumn: String? = null
    var nameColumn: String? = null
    var firstColumn: String? = null
    var lastColumn: String? = null
    var groupColumn: String? = null
    var contacts: MutableList<Contact> = ArrayList()
    var invalid: MutableList<InvalidRow> = ArrayList()
    var duplicates: Int = 0
    var skippedRows: Int = 0
    var warnings: MutableList<String> = ArrayList()

    val totalRows: Int get() = contacts.size + invalid.size + duplicates + skippedRows
    val sendable: List<Contact> get() = contacts.filter { it.status == Status.PENDING }
}

object Contacts {

    /**
     * تحلیل جدول CSV و ساخت لیست مخاطبین معتبر + گزارش خطاها.
     * Analyzes a parsed CSV table into contacts + a validation report.
     */
    fun analyze(table: Csv.Table, fileName: String, strictProvider: Boolean = false, blacklist: Set<String> = emptySet()): ParseReport {
        val rep = ParseReport()
        rep.fileName = fileName
        rep.encoding = table.encoding
        rep.delimiter = table.delimiter
        rep.headers = table.headers
        rep.warnings.addAll(table.warnings)
        if (table.headers.isEmpty()) throw IllegalArgumentException("ردیف سرستون‌ها پیدا نشد")

        // ---- نگاشت ستون‌ها
        val cleaned = table.headers.map { Rules.cleanHeader(it) }
        val idx = HashMap<String, Int>()
        for ((i, key) in cleaned.withIndex()) {
            if (key.isEmpty()) continue
            if (idx.containsKey(key)) rep.warnings.add("ستون تکراری «${table.headers[i]}» — آخرین ستون استفاده می‌شود")
            idx[key] = i
        }

        fun find(keys: List<String>): Int? {
            for (k in keys) if (idx.containsKey(k)) return idx[k]
            return null
        }

        val iNumber = find(Rules.NUMBER_KEYS)
        if (iNumber == null) {
            throw IllegalArgumentException(
                "ستون شماره پیدا نشد. نام‌های مجاز: number | phone | mobile | tel | msisdn | شماره | موبایل | تلفن همراه\n" +
                    "ستون‌های موجود در فایل: " + table.headers.joinToString(" | ")
            )
        }
        rep.numberColumn = table.headers[iNumber]
        val iName = find(Rules.NAME_KEYS)
        val iFirst = find(Rules.FIRST_KEYS)
        val iLast = find(Rules.LAST_KEYS)
        val iSkip = find(Rules.SKIP_KEYS)
        val iDelay = find(Rules.DELAY_KEYS)
        val iGroup = find(Rules.GROUP_KEYS)
        val iProvider = find(Rules.PROVIDER_KEYS)
        rep.nameColumn = if (iName != null) table.headers[iName] else null
        rep.firstColumn = if (iFirst != null) table.headers[iFirst] else null
        rep.lastColumn = if (iLast != null) table.headers[iLast] else null
        rep.groupColumn = if (iGroup != null) table.headers[iGroup] else null

        if (iName == null && iFirst == null && iLast == null) {
            rep.warnings.add("ستون نام پیدا نشد (اختیاری است). برای استفاده از {name} یک ستون name یا نام اضافه کنید.")
        }

        val seen = HashMap<String, Int>()   // number -> row
        var rowNo = 1
        for (r in table.rows) {
            rowNo++
            if (r.all { it.isBlank() }) { continue }
            fun cell(i: Int?): String = if (i == null || i >= r.size) "" else r[i].trim()

            val rawNumber = cell(iNumber)
            val normalized = Rules.normalizeNumber(rawNumber)
            val problem = Rules.numberProblem(rawNumber, normalized)

            // نام
            var name = ""
            if (iName != null) name = cell(iName)
            if (name.isBlank() && (iFirst != null || iLast != null)) {
                name = (cell(iFirst) + " " + cell(iLast)).trim()
            }

            if (iSkip != null && Rules.isTruthy(cell(iSkip))) { rep.skippedRows++; continue }

            if (problem != null) {
                rep.invalid.add(InvalidRow(rowNo, rawNumber, problem))
                continue
            }
            val num = normalized!!
            if (seen.containsKey(num)) { rep.duplicates++; continue }

            val group = cell(iGroup)
            if (iProvider != null) {
                val declared = cell(iProvider)
                val actual = Rules.operatorOf(num) ?: ""
                if (declared.isNotBlank() && actual.isNotBlank() && !actual.contains(declared) && !declared.contains(actual)) {
                    if (strictProvider) {
                        rep.invalid.add(InvalidRow(rowNo, rawNumber, "اپراتور اعلام‌شده «$declared» با پیش‌شماره ($actual) نمی‌خواند"))
                        continue
                    } else {
                        rep.warnings.add("ردیف $rowNo: اپراتور «$declared» با پیش‌شماره «$actual» نمی‌خواند")
                    }
                }
            }
            if (blacklist.contains(num)) { rep.skippedRows++; continue }

            val fields = HashMap<String, String>()
            for ((i, h) in table.headers.withIndex()) {
                val key = Rules.cleanHeader(h)
                if (key.isEmpty()) continue
                fields[key] = if (i < r.size) r[i].trim() else ""
            }

            val delay = if (iDelay != null) cell(iDelay).toLongOrNull() else null
            val c = Contact(rowNo, rawNumber, num, name, group, delay, fields)
            if (Rules.isDataCard(num)) {
                c.status = Status.SKIPPED
                c.error = "سیم‌کارت مودم/دیتا (0941) — پیامک نمی‌گیرد"
                rep.warnings.add("ردیف $rowNo: $num سیم‌کارت مودم است و کنار گذاشته شد")
            }
            seen[num] = rowNo
            rep.contacts.add(c)
        }

        if (rep.contacts.isEmpty() && rep.invalid.isNotEmpty()) {
            rep.warnings.add("هیچ شماره معتبری پیدا نشد؛ فایل را بررسی کنید.")
        }
        return rep
    }

    /** گزارش فشرده به‌صورت JSON برای پل HTTP و رابط ویندوز. */
    fun reportToJson(rep: ParseReport, includeContacts: Boolean): JSONObject {
        val o = JSONObject()
        o.put("file", rep.fileName)
        o.put("encoding", rep.encoding)
        o.put("delimiter", rep.delimiter.toString())
        o.put("headers", JSONArray(rep.headers))
        o.put("number_column", rep.numberColumn ?: JSONObject.NULL)
        o.put("name_column", rep.nameColumn ?: JSONObject.NULL)
        o.put("group_column", rep.groupColumn ?: JSONObject.NULL)
        o.put("rows_total", rep.totalRows)
        o.put("valid", rep.contacts.count { it.status == Status.PENDING })
        o.put("duplicates", rep.duplicates)
        o.put("invalid_count", rep.invalid.size)
        o.put("skipped", rep.skippedRows)
        o.put("warnings", JSONArray(rep.warnings))
        val inv = JSONArray()
        for (x in rep.invalid.take(500)) {
            inv.put(JSONObject().put("row", x.row).put("value", x.rawNumber).put("reason", x.reason))
        }
        o.put("invalid_rows", inv)
        if (includeContacts) {
            val arr = JSONArray()
            for (c in rep.contacts) {
                arr.put(JSONObject()
                    .put("row", c.row)
                    .put("number", c.number)
                    .put("name", c.name)
                    .put("group", c.group))
            }
            o.put("contacts", arr)
        }
        return o
    }

    /** ستون‌های قابل استفاده به‌عنوان جای‌نگهدار {token}. */
    fun placeholderTokens(rep: ParseReport): List<String> {
        val set = LinkedHashSet<String>()
        for (h in rep.headers) {
            val k = Rules.cleanHeader(h)
            if (k.isNotEmpty()) set.add(k)
        }
        set.addAll(Rules.BUILTIN_PLACEHOLDERS)
        return set.toList()
    }

    /** نوشتن ردیف‌های نامعتبر در فایل، تا کاربر بتواند اصلاح کند. */
    fun invalidToCsv(rep: ParseReport): String {
        val rows = rep.invalid.map { listOf(it.row.toString(), it.rawNumber, it.reason) }
        return Csv.toCsv(listOf("سطر", "شماره خام", "دلیل رد شدن"), rows)
    }

    fun contactsToCsv(contacts: List<Contact>): String {
        val headers = listOf("number", "name", "status", "parts", "sent_at", "error")
        val rows = contacts.map {
            listOf(
                it.number ?: it.rawNumber,
                it.name,
                it.status.label,
                it.parts.toString(),
                if (it.sentAt > 0) Time.format(it.sentAt) else "",
                it.error ?: ""
            )
        }
        return Csv.toCsv(headers, rows)
    }
}

object Time {
    private val fmt = java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss", java.util.Locale.US)
    fun format(ms: Long): String = fmt.format(java.util.Date(ms))
    fun today(): String = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).format(java.util.Date())
    fun now(): Long = System.currentTimeMillis()
}

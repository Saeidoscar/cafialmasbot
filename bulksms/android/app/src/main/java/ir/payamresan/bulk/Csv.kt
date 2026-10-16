package ir.payamresan.bulk

import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.nio.ByteBuffer
import java.nio.charset.Charset
import java.nio.charset.CodingErrorAction

/**
 * خواندن CSV مقاوم: تشخیص انکودینگ، تشخیص جداکننده، پشتیبانی از فیلدهای داخل کوتیشن.
 * Robust CSV reading: encoding detection, delimiter sniffing, quoted fields.
 */
object Csv {

    data class Table(
        val headers: List<String>,
        val rows: List<List<String>>,
        val delimiter: Char,
        val encoding: String,
        val warnings: MutableList<String> = mutableListOf()
    )

    private val CANDIDATE_DELIMS = charArrayOf(',', ';', '\t', '|')

    fun read(input: InputStream, maxBytes: Int = 32 * 1024 * 1024): Table {
        val bytes = readAll(input, maxBytes)
        val (text, encName) = decode(bytes)
        return parse(text, encName)
    }

    fun readAll(input: InputStream, maxBytes: Int): ByteArray {
        val out = ByteArrayOutputStream()
        val buf = ByteArray(64 * 1024)
        var total = 0
        while (true) {
            val n = input.read(buf)
            if (n <= 0) break
            total += n
            if (total > maxBytes) throw IllegalArgumentException("فایل بزرگ‌تر از حد مجاز است (${maxBytes / 1048576} مگابایت)")
            out.write(buf, 0, n)
        }
        return out.toByteArray()
    }

    /** تشخیص انکودینگ: BOM → UTF-16/UTF-8، سپس UTF-8 سخت‌گیرانه، سپس windows-1256. */
    fun decode(bytes: ByteArray): Pair<String, String> {
        if (bytes.size >= 2) {
            if (bytes[0] == 0xFF.toByte() && bytes[1] == 0xFE.toByte())
                return String(bytes, 2, bytes.size - 2, Charset.forName("UTF-16LE")) to "UTF-16LE"
            if (bytes[0] == 0xFE.toByte() && bytes[1] == 0xFF.toByte())
                return String(bytes, 2, bytes.size - 2, Charset.forName("UTF-16BE")) to "UTF-16BE"
        }
        var start = 0
        if (bytes.size >= 3 && bytes[0] == 0xEF.toByte() && bytes[1] == 0xBB.toByte() && bytes[2] == 0xBF.toByte()) start = 3
        // UTF-8 سخت‌گیرانه
        try {
            val dec = Charset.forName("UTF-8").newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
            val cb = dec.decode(ByteBuffer.wrap(bytes, start, bytes.size - start))
            return cb.toString() to "UTF-8"
        } catch (e: Exception) {
            // ادامه: احتمالاً CP1256 (ویندوز فارسی) یا UTF-16 بدون BOM
        }
        // UTF-16 بدون BOM: تعداد زیاد بایت صفر
        var zeros = 0
        for (i in 0 until minOf(bytes.size, 512)) if (bytes[i] == 0.toByte()) zeros++
        if (zeros > 64) {
            val cs = Charset.forName("UTF-16LE")
            return String(bytes, cs).replace("\u0000", "") to "UTF-16LE*"
        }
        return String(bytes, Charset.forName("windows-1256")) to "windows-1256"
    }

    fun parse(text0: String, encoding: String): Table {
        val text = text0.replace("\r\n", "\n").replace('\r', '\n')
        val delimiter = sniffDelimiter(text)
        val rows = ArrayList<List<String>>()
        val field = StringBuilder()
        val row = ArrayList<String>()
        var inQuotes = false
        var i = 0
        while (i < text.length) {
            val c = text[i]
            if (inQuotes) {
                if (c == '"') {
                    if (i + 1 < text.length && text[i + 1] == '"') { field.append('"'); i++ }
                    else inQuotes = false
                } else field.append(c)
            } else {
                when (c) {
                    '"' -> {
                        if (field.isEmpty()) inQuotes = true else field.append(c)
                    }
                    delimiter -> { row.add(field.toString()); field.setLength(0) }
                    '\n' -> { row.add(field.toString()); field.setLength(0); rows.add(ArrayList(row)); row.clear() }
                    else -> field.append(c)
                }
            }
            i++
        }
        if (field.isNotEmpty() || row.isNotEmpty()) { row.add(field.toString()); rows.add(ArrayList(row)) }

        // حذف ردیف‌های کاملاً خالی از ابتدا و انتها (اما ردیف‌های میانی حفظ می‌شوند)
        while (rows.isNotEmpty() && rows[0].all { it.isBlank() }) rows.removeAt(0)
        while (rows.isNotEmpty() && rows[rows.size - 1].all { it.isBlank() }) rows.removeAt(rows.size - 1)
        if (rows.isEmpty()) throw IllegalArgumentException("فایل CSV خالی است")

        val headers = rows[0].map { it.trim() }
        val body = rows.drop(1)
        val table = Table(headers, body, delimiter, encoding)
        if (encoding != "UTF-8") table.warnings.add("انکودینگ فایل: $encoding (اگر متن به‌هم‌ریخته است، فایل را با UTF-8 ذخیره کنید)")
        return table
    }

    /** تشخیص جداکننده: بیشترین تکرار بیرون از کوتیشن در ۵ خط اول. */
    fun sniffDelimiter(text: String): Char {
        var idxEnd = 0
        var lines = 0
        while (idxEnd < text.length && lines < 5) {
            if (text[idxEnd] == '\n') lines++
            idxEnd++
        }
        val head = if (idxEnd > 0) text.substring(0, idxEnd) else text
        var best = ','
        var bestCount = 0
        for (d in CANDIDATE_DELIMS) {
            var count = 0
            var inQ = false
            for (c in head) {
                if (c == '"') inQ = !inQ
                else if (c == d && !inQ) count++
            }
            if (count > bestCount) { bestCount = count; best = d }
        }
        // اگر هیچ جداکننده‌ای پیدا نشد، تک‌ستونی با ,
        return best
    }

    fun escape(value: String?): String {
        val v = value ?: ""
        return if (v.contains(',') || v.contains('"') || v.contains('\n') || v.contains('\r')) {
            "\"" + v.replace("\"", "\"\"") + "\""
        } else v
    }

    fun toCsv(headers: List<String>, rows: List<List<String>>): String {
        val sb = StringBuilder()
        sb.append(headers.joinToString(",") { escape(it) }).append("\r\n")
        for (r in rows) sb.append(r.joinToString(",") { escape(it) }).append("\r\n")
        // BOM برای اکسل
        return "\ufeff" + sb.toString()
    }
}

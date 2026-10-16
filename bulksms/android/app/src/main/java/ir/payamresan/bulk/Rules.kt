package ir.payamresan.bulk

/**
 * قوانین CSV و شماره‌ها — نسخه ۱.۰
 * Canonical CSV rules v1.0.
 *
 * این فایل تنها مرجع قوانین است و باید با این دو فایل هم‌خوان بماند:
 *   bulksms/schema/contacts.rules.json
 *   bulksms/windows/payamresan/rules.py
 */
object Rules {

    const val VERSION = "1.0"

    // ---------------------------------------------------------------- headers

    /** ستون شماره — به ترتیب اولویت. (Aliases for the required number column.) */
    val NUMBER_HEADERS = listOf(
        "number", "شماره",
        "phone", "phone_number", "phonenumber", "mobile", "mobile_number", "mobilenumber",
        "cell", "cellphone", "cell_phone", "tel", "telephone", "msisdn", "contact", "contact_number",
        "شماره تماس", "شماره موبایل", "موبایل", "تلفن", "تلفن همراه", "شماره تلفن", "شماره همراه",
        "شمارهتماس", "شمارهموبایل", "همراه"
    )

    /** ستون نام کامل (اختیاری). */
    val NAME_HEADERS = listOf(
        "name", "full_name", "fullname", "display_name",
        "نام", "نام کامل", "اسم", "نام و نام خانوادگی", "نامکامل", "نامونامخانوادگی"
    )

    /** ستون نام کوچک (اختیاری). */
    val FIRST_HEADERS = listOf(
        "first_name", "firstname", "given_name", "givenname",
        "نام کوچک", "نامکوچک", "اسمو"
    )

    /** ستون نام خانوادگی (اختیاری). */
    val LAST_HEADERS = listOf(
        "last_name", "lastname", "family", "family_name", "surname",
        "نام خانوادگی", "فامیل", "فامیلی", "نامخانوادگی"
    )

    /** ستون‌های کنترلی هر ردیف (اختیاری). */
    val SKIP_HEADERS = listOf("skip", "ignored", "exclude", "رد", "ردیف_رد", "نفرست")
    val DELAY_HEADERS = listOf("delay_ms", "delay", "تاخیر", "تأخیر", "تاخیر_ms")
    val GROUP_HEADERS = listOf("group", "tag", "group_name", "گروه", "برچسب", "تگ")
    val PROVIDER_HEADERS = listOf("provider", "operator", "carrier", "اپراتور", "همراه", "مالک")

    // ------------------------------------------------------------- operators
    // پیش‌شماره‌ها فقط برای «برچسب‌گذاری و فیلتر» استفاده می‌شود و به‌صورت پیش‌فرض
    // باعث رد شدن شماره نمی‌شود (مگر حالت سخت‌گیرانه فعال باشد).
    val OPERATORS: List<Pair<String, List<String>>> = listOf(
        "همراه اول" to listOf(
            "0910", "0911", "0912", "0913", "0914", "0915", "0916", "0917", "0918", "0919",
            "0990", "0991", "0992", "0993", "0994"
        ),
        "ایرانسل" to listOf(
            "0900", "0901", "0902", "0903", "0904", "0905",
            "0930", "0933", "0935", "0936", "0937", "0938", "0939", "0941"
        ),
        "رایتل" to listOf("0920", "0921", "0922"),
        "تالیا" to listOf("0932"),
        "اسپادان" to listOf("0931"),
        "کیش" to listOf("0934"),
        "شاتل‌موبایل" to listOf("09981"),
        "نامشخص/MVNO" to listOf("0995", "0996", "0997", "0998", "0999")
    )

    /** شماره‌های نمونه/جعلی که هرگز نباید پیام بگیرند. */
    val FAKE_NUMBERS = setOf(
        "09123456789", "09123456788", "09123456787", "09876543210",
        "09111111111", "09222222222", "09333333333", "09444444444", "09555555555",
        "09666666666", "09777777777", "09888888888", "09999999999",
        "09120000000", "09000000000", "09100000000", "09190000000"
    )

    /** سیم‌کارت‌های مودم/دیتا که پیامک روی آن‌ها کار نمی‌کند. */
    val DATACARD_PREFIXES = listOf("0941")

    // ------------------------------------------------------------- utilities

    private fun isInvisible(c: Char): Boolean =
        c == '\u200c' || c == '\u200d' || c == '\u200e' || c == '\u200f' ||
            c == '\ufeff' || c == '\u00a0' || c == '\u2060' || c == '\u202a' ||
            c == '\u202b' || c == '\u202c'

    /** یکسان‌سازی نام ستون: حذف فاصله/خط تیره/نقطه/فاصله‌مجازی + کوچک کردن حروف. */
    fun cleanHeader(raw: String?): String {
        if (raw == null) return ""
        val sb = StringBuilder()
        for (c in raw.trim().lowercase()) {
            when {
                isInvisible(c) -> {}
                c.isWhitespace() -> {}
                c == '_' || c == '-' || c == '.' || c == '(' || c == ')' || c == '"' || c == '\'' -> {}
                else -> sb.append(c)
            }
        }
        return sb.toString()
    }

    // پیش‌محاسبه مجموعه‌های یکسان‌شده
    val NUMBER_KEYS = NUMBER_HEADERS.map { cleanHeader(it) }
    val NAME_KEYS = NAME_HEADERS.map { cleanHeader(it) }
    val FIRST_KEYS = FIRST_HEADERS.map { cleanHeader(it) }
    val LAST_KEYS = LAST_HEADERS.map { cleanHeader(it) }
    val SKIP_KEYS = SKIP_HEADERS.map { cleanHeader(it) }
    val DELAY_KEYS = DELAY_HEADERS.map { cleanHeader(it) }
    val GROUP_KEYS = GROUP_HEADERS.map { cleanHeader(it) }
    val PROVIDER_KEYS = PROVIDER_HEADERS.map { cleanHeader(it) }

    // ------------------------------------------------------------ numbers

    /**
     * تبدیل ارقام فارسی/عربی به لاتین و پاک‌سازی: فقط ارقام و یک + ابتدای رشته.
     * Persian/Arabic-Indic digits -> ASCII, keep only digits (and a leading +).
     */
    fun digitsOnly(raw: String?): String {
        if (raw == null) return ""
        val sb = StringBuilder()
        for (c in raw) {
            val d: Char? = when {
                c in '0'..'9' -> c
                c in '\u06f0'..'\u06f9' -> ('0' + (c - '\u06f0'))
                c in '\u0660'..'\u0669' -> ('0' + (c - '\u0660'))
                else -> null
            }
            if (d != null) sb.append(d) else if (c == '+' && sb.isEmpty()) sb.append('+')
        }
        return sb.toString()
    }

    /**
     * نرمال‌سازی شماره موبایل ایران.
     * خروجی: 09XXXXXXXXX  یا  null اگر شماره موبایل ایران نباشد.
     */
    fun normalizeNumber(raw: String?): String? {
        var s = digitsOnly(raw)
        if (s.isEmpty()) return null
        val hadPlus = s.startsWith("+")
        if (hadPlus) s = s.substring(1)
        // حذف صفرهای ابتدایی اضافی (۰۰۹۸ → ۹۸)
        var t = s
        if (t.startsWith("98") && (t.length == 12 || t.length == 13)) {
            t = t.substring(2)
        } else if (t.startsWith("0098")) {
            t = t.substring(4)
        } else if (t.startsWith("0")) {
            t = t.substring(1)
        }
        // حالا باید 10 رقم و با 9 شروع شود
        if (t.length != 10 || !t.startsWith("9")) return null
        return "0$t"
    }

    fun isValidIranMobile(number: String?): Boolean =
        number != null && Regex("^09\\d{9}$").matches(number)

    fun operatorOf(number: String?): String? {
        if (!isValidIranMobile(number)) return null
        val n = number!!
        for ((op, prefixes) in OPERATORS) {
            for (p in prefixes) {
                if (n.startsWith(p)) return op
            }
        }
        return "نامشخص"
    }

    /** دلایل احتمالی بی‌اعتبار بودن یک شماره (برای گزارش خطاها). */
    fun numberProblem(raw: String?, normalized: String?): String? {
        if (raw.isNullOrBlank()) return "ستون شماره خالی است"
        if (normalized == null) return "شماره موبایل ایران نیست (بعد از نرمال‌سازی معتبر نشد)"
        if (!isValidIranMobile(normalized)) return "قالب شماره صحیح نیست ($normalized)"
        if (FAKE_NUMBERS.contains(normalized)) return "شماره نمونه/جعلی است"
        if (Regex("^(\\d)\\1{9}$").matches(normalized)) return "همه ارقام یکسان است"
        return null
    }

    fun isDataCard(number: String?): Boolean {
        if (number == null) return false
        for (p in DATACARD_PREFIXES) if (number.startsWith(p)) return true
        return false
    }

    fun toE164(number: String): String =
        if (number.startsWith("0")) "+98" + number.substring(1) else number

    /** مقدار ستون‌های بولی/ردیفی. */
    fun isTruthy(v: String?): Boolean {
        if (v == null) return false
        val s = v.trim().lowercase()
        return s == "1" || s == "true" || s == "yes" || s == "y" || s == "on" ||
            s == "بله" || s == "آری" || s == "درست" || s == "رد" || s == "فعال"
    }

    /** توکن‌های قابل استفاده در متن پیام: {name} {number} ... */
    val BUILTIN_PLACEHOLDERS = listOf("name", "number", "first_name", "last_name", "index", "group", "date", "time")
}

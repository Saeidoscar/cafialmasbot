"""قوانین یکسان با اپ اندروید (Rules.kt) — Canonical CSV rules, version 1.0.

این ماژول تنها مرجع قوانین در سمت ویندوز است و باید با موارد زیر هم‌خوان بماند:
    bulksms/android/app/src/main/java/ir/payamresan/bulk/Rules.kt
    bulksms/schema/contacts.rules.json
"""
from __future__ import annotations

import re
import unicodedata

RULES_VERSION = "1.0"

# ---------------------------------------------------------------- ستون شماره
NUMBER_HEADERS = [
    "number", "شماره",
    "phone", "phone_number", "phonenumber", "mobile", "mobile_number", "mobilenumber",
    "cell", "cellphone", "cell_phone", "tel", "telephone", "msisdn", "contact", "contact_number",
    "شماره تماس", "شماره موبایل", "موبایل", "تلفن", "تلفن همراه", "شماره تلفن", "شماره همراه",
    "شمارهتماس", "شمارهموبایل", "همراه",
]

# ------------------------------------------------------------- ستون نام (اختیاری)
NAME_HEADERS = [
    "name", "full_name", "fullname", "display_name",
    "نام", "نام کامل", "اسم", "نام و نام خانوادگی", "نامکامل", "نامونامخانوادگی",
]
FIRST_HEADERS = ["first_name", "firstname", "given_name", "givenname", "نام کوچک", "نامکوچک", "اسمو"]
LAST_HEADERS = ["last_name", "lastname", "family", "family_name", "surname", "نام خانوادگی", "فامیل", "فامیلی", "نامخانوادگی"]

# ------------------------------------------------------------ ستون‌های کنترلی (اختیاری)
SKIP_HEADERS = ["skip", "ignored", "exclude", "رد", "ردیف_رد", "نفرست"]
DELAY_HEADERS = ["delay_ms", "delay", "تاخیر", "تأخیر", "تاخیر_ms"]
GROUP_HEADERS = ["group", "tag", "group_name", "گروه", "برچسب", "تگ"]
PROVIDER_HEADERS = ["provider", "operator", "carrier", "اپراتور", "همراه", "مالک"]

# ------------------------------------------------------------------ اپراتورها
OPERATORS = [
    ("همراه اول", ["0910", "0911", "0912", "0913", "0914", "0915", "0916", "0917", "0918", "0919",
                   "0990", "0991", "0992", "0993", "0994"]),
    ("ایرانسل", ["0900", "0901", "0902", "0903", "0904", "0905",
                 "0930", "0933", "0935", "0936", "0937", "0938", "0939", "0941"]),
    ("رایتل", ["0920", "0921", "0922"]),
    ("تالیا", ["0932"]),
    ("اسپادان", ["0931"]),
    ("کیش", ["0934"]),
    ("شاتل‌موبایل", ["09981"]),
    ("نامشخص/MVNO", ["0995", "0996", "0997", "0998", "0999"]),
]

FAKE_NUMBERS = {
    "09123456789", "09123456788", "09123456787", "09876543210",
    "09111111111", "09222222222", "09333333333", "09444444444", "09555555555",
    "09666666666", "09777777777", "09888888888", "09999999999",
    "09120000000", "09000000000", "09100000000", "09190000000",
}

DATACARD_PREFIXES = ["0941"]

BUILTIN_PLACEHOLDERS = ["name", "number", "first_name", "last_name", "index", "group", "date", "time"]

_INVISIBLE = "\u200c\u200d\u200e\u200f\ufeff\u00a0\u2060\u202a\u202b\u202c"


def clean_header(raw: str | None) -> str:
    """یکسان‌سازی نام ستون: حذف فاصله/نقطه/فاصله‌مجازی و کوچک کردن حروف."""
    if not raw:
        return ""
    s = unicodedata.normalize("NFKC", str(raw)).strip().lower()
    out = []
    for ch in s:
        if ch in _INVISIBLE or ch.isspace():
            continue
        if ch in "_-.\"'()":
            continue
        out.append(ch)
    return "".join(out)


NUMBER_KEYS = [clean_header(h) for h in NUMBER_HEADERS]
NAME_KEYS = [clean_header(h) for h in NAME_HEADERS]
FIRST_KEYS = [clean_header(h) for h in FIRST_HEADERS]
LAST_KEYS = [clean_header(h) for h in LAST_HEADERS]
SKIP_KEYS = [clean_header(h) for h in SKIP_HEADERS]
DELAY_KEYS = [clean_header(h) for h in DELAY_HEADERS]
GROUP_KEYS = [clean_header(h) for h in GROUP_HEADERS]
PROVIDER_KEYS = [clean_header(h) for h in PROVIDER_HEADERS]

_PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹"
_ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩"
_SEP_CHARS = " \t\u00a0-_()[]{}.\u200c\u200f\u200e+"


def digits_only(raw: str | None) -> str:
    """تبدیل ارقام فارسی/عربی به لاتین و نگه‌داشتن فقط ارقام (و + ابتدای رشته)."""
    if raw is None:
        return ""
    out = []
    for ch in str(raw):
        if ch.isdigit() and ord(ch) < 128:
            out.append(ch)
        elif ch in _PERSIAN_DIGITS:
            out.append(str(_PERSIAN_DIGITS.index(ch)))
        elif ch in _ARABIC_DIGITS:
            out.append(str(_ARABIC_DIGITS.index(ch)))
        elif ch == "+" and not out:
            out.append("+")
    return "".join(out)


def normalize_number(raw: str | None) -> str | None:
    """نرمال‌سازی شماره موبایل ایران → 09XXXXXXXXX یا None."""
    s = digits_only(raw)
    if not s:
        return None
    if s.startswith("+"):
        s = s[1:]
    t = s
    if t.startswith("0098"):
        t = t[4:]
    elif t.startswith("98") and len(t) in (12, 13):
        t = t[2:]
    elif t.startswith("0"):
        t = t[1:]
    if len(t) != 10 or not t.startswith("9"):
        return None
    return "0" + t


def is_valid_iran_mobile(number: str | None) -> bool:
    return bool(number) and bool(re.fullmatch(r"09\d{9}", number or ""))


def operator_of(number: str | None) -> str | None:
    if not is_valid_iran_mobile(number):
        return None
    for name, prefixes in OPERATORS:
        for p in prefixes:
            if number.startswith(p):
                return name
    return "نامشخص"


def number_problem(raw: str | None, normalized: str | None) -> str | None:
    if raw is None or not str(raw).strip():
        return "ستون شماره خالی است"
    if not normalized:
        return "شماره موبایل ایران نیست (بعد از نرمال‌سازی معتبر نشد)"
    if not is_valid_iran_mobile(normalized):
        return f"قالب شماره صحیح نیست ({normalized})"
    if normalized in FAKE_NUMBERS:
        return "شماره نمونه/جعلی است"
    if re.fullmatch(r"(\d)\1{9}", normalized):
        return "همه ارقام یکسان است"
    return None


def is_data_card(number: str | None) -> bool:
    return bool(number) and any(number.startswith(p) for p in DATACARD_PREFIXES)


def to_e164(number: str) -> str:
    return "+98" + number[1:] if number.startswith("0") else number


def is_truthy(v: str | None) -> bool:
    if v is None:
        return False
    s = str(v).strip().lower()
    return s in {"1", "true", "yes", "y", "on", "بله", "آری", "درست", "فعال", "رد"}


# ------------------------------------------------------------------ متن پیامک
GSM_BASIC = (
    "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\u001bÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?"
    "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"
)
GSM_EXT = "^{}\\[~]|€"


def is_gsm7(text: str) -> bool:
    return all(c in GSM_EXT or c in GSM_BASIC for c in text)


def segments(text: str):
    """(تعداد پیامک، gsm7?) — پیامک فارسی (یونیکد): ۷۰ کاراکتر، لاتین: ۱۶۰."""
    if not text:
        return 0, True
    gsm = is_gsm7(text)
    if gsm:
        length = sum(2 if c in GSM_EXT else 1 for c in text)
        single, multi = 160, 153
    else:
        length = len(text)
        single, multi = 70, 67
    parts = 1 if length <= single else (length + multi - 1) // multi
    return parts, gsm


_TOKEN_RE = re.compile(r"\{([A-Za-z0-9_\u0600-\u06FF \-]+)\}")


def render_template(template: str, contact, index: int, headers=None) -> str:
    """جای‌گذاری {name} {number} {group} {index} {date} {time} و هر ستون دیگر CSV.

    contact می‌تواند dict یا dataclass باشد.
    """
    import datetime

    if not isinstance(contact, dict):
        fields = getattr(contact, "fields", {}) or {}
        contact = {
            "name": getattr(contact, "name", "") or "",
            "number": getattr(contact, "number", None),
            "raw": getattr(contact, "raw", "") or "",
            "group": getattr(contact, "group", "") or "",
            "fields": fields,
        }
    now = datetime.datetime.now()

    def repl(m):
        key = clean_header(m.group(1))
        if key in ("name", "نام", "نامکامل"):
            return contact.get("name") or "همراه گرامی"
        if key in ("first_name", "نامکوچک"):
            return (contact.get("name") or "").split(" ")[0]
        if key in ("last_name", "نامخانوادگی"):
            parts = (contact.get("name") or "").split(" ")
            return parts[-1] if parts and parts[0] else ""
        if key in ("number", "شماره", "موبایل"):
            return contact.get("number") or contact.get("raw") or ""
        if key in ("index", "ردیف"):
            return str(index + 1)
        if key in ("group", "گروه"):
            return contact.get("group") or ""
        if key == "date":
            return now.strftime("%Y-%m-%d")
        if key == "time":
            return now.strftime("%H:%M")
        return (contact.get("fields") or {}).get(key, "")

    return _TOKEN_RE.sub(repl, template)


def allowed_number_headers_text() -> str:
    return " | ".join(NUMBER_HEADERS)


def allowed_name_headers_text() -> str:
    return " | ".join(NAME_HEADERS)

"""تست خودکار قوانین و CSV — بدون نیاز به GUI.

اجرا:  python tools/selftest.py      (از پوشهٔ bulksms/windows)
"""
from __future__ import annotations


import os
import sys

# چاپ متن فارسی در کنسول ویندوز (CI) بدون خطای انکودینگ
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from payamresan import csvio, rules  # noqa: E402

FAILED = []


def check(name, cond, extra=""):
    print(("PASS  " if cond else "FAIL  ") + name + (f"  → {extra}" if extra and not cond else ""))
    if not cond:
        FAILED.append(name)


# ---------------------------------------------------------------- parity check
KOTLIN_LISTS = {
    "NUMBER_HEADERS": rules.NUMBER_HEADERS,
    "NAME_HEADERS": rules.NAME_HEADERS,
    "FIRST_HEADERS": rules.FIRST_HEADERS,
    "LAST_HEADERS": rules.LAST_HEADERS,
    "SKIP_HEADERS": rules.SKIP_HEADERS,
    "DELAY_HEADERS": rules.DELAY_HEADERS,
    "GROUP_HEADERS": rules.GROUP_HEADERS,
    "PROVIDER_HEADERS": rules.PROVIDER_HEADERS,
    "BUILTIN_PLACEHOLDERS": rules.BUILTIN_PLACEHOLDERS,
}


def parse_kotlin_lists(text: str) -> dict:
    """استخراج رشته‌های داخل listOf(...) برای هر val در فایل Kotlin."""
    import re
    out = {}
    for name in KOTLIN_LISTS:
        m = re.search(rf"val {name}\s*=\s*listOf\((.*?)\)", text, re.S)
        if not m:
            continue
        out[name] = re.findall(r'"((?:[^"\\]|\\.)*)"', m.group(1))
    return out


def check_parity():
    """قوانین ویندوز == قوانین اندروید == schema (تا هرگز واگرا نشوند)."""
    import json
    import pathlib

    base = pathlib.Path(__file__).resolve().parents[2]        # پوشهٔ bulksms/
    kt = base / "android/app/src/main/java/ir/payamresan/bulk/Rules.kt"
    schema_path = base / "schema/contacts.rules.json"

    if kt.exists():
        kotlin = parse_kotlin_lists(kt.read_text(encoding="utf-8"))
        for name, py_list in KOTLIN_LISTS.items():
            kt_list = kotlin.get(name)
            if kt_list is None:
                check(f"parity: {name} در Rules.kt پیدا شد", False)
                continue
            check(f"parity: {name} اندروید == ویندوز", [x.strip() for x in kt_list] == list(py_list),
                  f"اندروید={kt_list} ویندوز={list(py_list)}")
    else:
        print("SKIP  parity: فایل Rules.kt اندروید پیدا نشد")

    if schema_path.exists():
        data = json.loads(schema_path.read_text(encoding="utf-8"))
        check("parity: نسخهٔ schema == نسخهٔ قوانین", data.get("version") == rules.RULES_VERSION,
              f"schema={data.get('version')} rules={rules.RULES_VERSION}")
        check("parity: مترادف‌های شماره در schema",
              data["columns"]["number"]["aliases"] == list(rules.NUMBER_HEADERS))
        check("parity: مترادف‌های نام در schema",
              data["columns"]["name"]["aliases"] == list(rules.NAME_HEADERS))
        check("parity: پیش‌شماره‌های اپراتور در schema",
              data["operators"] == {n: list(p) for n, p in rules.OPERATORS})
    else:
        print("SKIP  parity: فایل schema/contacts.rules.json پیدا نشد")


def main():
    print(f"قوانین نسخهٔ {rules.RULES_VERSION}")

    # --- نرمال‌سازی شماره
    cases = {
        "09121234567": "09121234567",
        "۰۹۱۲۱۲۳۴۵۶۷": "09121234567",
        "٠٩١٢١٢٣٤٥٦٧": "09121234567",
        "+989121234567": "09121234567",
        "00989121234567": "09121234567",
        "989121234567": "09121234567",
        "0912 123 4567": "09121234567",
        "0912-123-4567": "09121234567",
        "12345": None,
        "": None,
        "0212345678": None,
        "0812345678": None,
        "0912123456789": None,
    }
    for raw, want in cases.items():
        got = rules.normalize_number(raw)
        check(f"normalize({raw!r}) == {want}", got == want, f"گرفته شد {got!r}")

    # --- اپراتور
    check("operator(0912…) == همراه اول", rules.operator_of("09121234567") == "همراه اول")
    check("operator(0935…) == ایرانسل", rules.operator_of("09351234568") == "ایرانسل")
    check("operator(0920…) == رایتل", rules.operator_of("09201234567") == "رایتل")

    # --- شماره‌های جعلی
    check("شمارهٔ جعلی رد می‌شود", rules.number_problem("09123456789", "09123456789") is not None)
    check("شمارهٔ یکسان رد می‌شود", rules.number_problem("09111111111", "09111111111") is not None)
    check("سیم مودم شناسایی می‌شود", rules.is_data_card("09411234567"))

    # --- تحلیل CSV کامل
    text = (
        "نام,شماره,گروه\n"
        "علی رضایی,09121234567,مشتری\n"
        "مریم حسینی,+989351234568,همکار\n"
        "علی رضایی,0912 123 4567,تکراری\n"
        "خراب,12345,بد\n"
        ",09361112233,\n"
        "تست نمونه,09123456789,جعلی\n"
    )
    headers, rows, delim = csvio.parse_text(text)
    check("سرستون‌های فارسی شناخته می‌شوند", csvio.rules.clean_header("شماره") in csvio.rules.NUMBER_KEYS)
    rep = csvio.analyze(headers, rows, "test.csv")
    check("ستون شماره = شماره", rep.number_column == "شماره", str(rep.number_column))
    check("ستون نام = نام", rep.name_column == "نام", str(rep.name_column))
    check("تعداد معتبر = ۳", len(rep.valid) == 3, str(len(rep.valid)))
    check("تکراری = ۱", rep.duplicates == 1, str(rep.duplicates))
    check("نامعتبر = ۲", len(rep.invalid) == 2, str(len(rep.invalid)))
    check("گروه منتقل شده", any(c.group == "مشتری" for c in rep.contacts))

    # --- قالب و شمارش پیامک
    c = rep.contacts[0]
    out = rules.render_template("{name} عزیز، به شمارهٔ {number} پیام دادیم. ردیف {index}", c, 0)
    check("جای‌گذاری نام انجام شد", "علی رضایی" in out, out)
    check("جای‌گذاری شماره انجام شد", "09121234567" in out, out)
    parts_fa, gsm_fa = rules.segments("سلام " * 40)
    check("متن فارسی یونیکد است", gsm_fa is False)
    check("متن فارسی چندبخشی می‌شود", parts_fa > 1, str(parts_fa))
    parts_en, gsm_en = rules.segments("Hello world")
    check("متن لاتین GSM-7 است", gsm_en is True and parts_en == 1)

    # --- ستون‌های نامعتبر
    try:
        csvio.analyze(["foo", "bar"], [["a", "b"]], "x.csv")
        check("نبود ستون شماره خطا می‌دهد", False)
    except ValueError as e:
        check("نبود ستون شماره خطا می‌دهد", "ستون شماره" in str(e))

    # --- نمونهٔ همراه برنامه سالم است
    h2, r2, _ = csvio.parse_text(csvio.SAMPLE_CSV)
    rep2 = csvio.analyze(h2, r2, "sample.csv")
    check("نمونهٔ CSV بدون خطا", len(rep2.valid) == 4 and not rep2.invalid,
          f"valid={len(rep2.valid)} invalid={rep2.invalid}")

    # --- هم‌خوانی قوانین پایتون با Kotlin (اپ اندروید) و schema
    check_parity()

    print()
    if FAILED:
        print(f"❌ {len(FAILED)} تست ناموفق: {', '.join(FAILED)}")
        return 1
    print("✅ همهٔ تست‌ها موفق بود")
    return 0


if __name__ == "__main__":
    sys.exit(main())

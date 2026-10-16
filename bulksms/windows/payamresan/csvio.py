"""خواندن/نوشتن CSV با تشخیص انکودینگ و جداکننده — دقیقاً مثل اپ اندروید."""
from __future__ import annotations

import csv
import io
from dataclasses import dataclass, field

from . import rules

CANDIDATE_DELIMS = [",", ";", "\t", "|"]


def decode_bytes(data: bytes):
    """(متن، نام انکودینگ) — UTF-8/UTF-16 BOM، سپس UTF-8 سخت‌گیرانه، سپس windows-1256."""
    if data[:2] == b"\xff\xfe":
        return data[2:].decode("utf-16-le", errors="replace"), "UTF-16LE"
    if data[:2] == b"\xfe\xff":
        return data[2:].decode("utf-16-be", errors="replace"), "UTF-16BE"
    start = 3 if data[:3] == b"\xef\xbb\xbf" else 0
    try:
        return data[start:].decode("utf-8"), "UTF-8"
    except UnicodeDecodeError:
        pass
    if data[:512].count(b"\x00") > 64:
        return data.decode("utf-16-le", errors="replace").replace("\x00", ""), "UTF-16LE*"
    try:
        return data.decode("cp1256"), "windows-1256"
    except Exception:
        return data.decode("utf-8", errors="replace"), "UTF-8?"


def sniff_delimiter(text: str) -> str:
    head = "\n".join(text.splitlines()[:5])
    best, best_count = ",", 0
    for d in CANDIDATE_DELIMS:
        count, in_q = 0, False
        for ch in head:
            if ch == '"':
                in_q = not in_q
            elif ch == d and not in_q:
                count += 1
        if count > best_count:
            best, best_count = d, count
    return best


def parse_text(text: str):
    """(headers, rows, delimiter) با پشتیبانی از فیلدهای داخل کوتیشن."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    delim = sniff_delimiter(text)
    reader = csv.reader(io.StringIO(text), delimiter=delim)
    rows = [list(r) for r in reader]
    while rows and all(not (c or "").strip() for c in rows[0]):
        rows.pop(0)
    while rows and all(not (c or "").strip() for c in rows[-1]):
        rows.pop()
    if not rows:
        raise ValueError("فایل CSV خالی است")
    headers = [(c or "").strip() for c in rows[0]]
    return headers, rows[1:], delim


def read_file(path: str):
    with open(path, "rb") as f:
        data = f.read()
    text, enc = decode_bytes(data)
    headers, rows, delim = parse_text(text)
    return headers, rows, delim, enc


def write_file(path: str, headers, rows) -> None:
    """نوشتن با BOM و UTF-8 تا اکسل فارسی درست نشان دهد."""
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\r\n")
    w.writerow(list(headers))
    for r in rows:
        w.writerow(["" if c is None else str(c) for c in r])
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        f.write(buf.getvalue())


# ------------------------------------------------------------------ تحلیل مخاطبین

@dataclass
class Contact:
    row: int
    raw: str
    number: str | None
    name: str = ""
    group: str = ""
    delay_ms: int | None = None
    fields: dict = field(default_factory=dict)
    status: str = "PENDING"     # PENDING | SENT | FAILED | SKIPPED | INVALID
    error: str = ""

    def as_json(self) -> dict:
        d = {"row": self.row, "number": self.number, "name": self.name, "group": self.group}
        if self.delay_ms is not None:
            d["delay_ms"] = self.delay_ms
        for k, v in (self.fields or {}).items():
            d.setdefault(k, v)
        return d


@dataclass
class Report:
    file_name: str = ""
    encoding: str = "UTF-8"
    delimiter: str = ","
    headers: list = field(default_factory=list)
    number_column: str | None = None
    name_column: str | None = None
    group_column: str | None = None
    contacts: list = field(default_factory=list)
    invalid: list = field(default_factory=list)     # [(row, raw, reason)]
    duplicates: int = 0
    skipped: int = 0
    warnings: list = field(default_factory=list)

    @property
    def valid(self):
        return [c for c in self.contacts if c.status == "PENDING"]

    @property
    def total_rows(self):
        return len(self.contacts) + len(self.invalid) + self.duplicates + self.skipped


def analyze(headers, rows, file_name="", strict_provider=False, blacklist=None) -> Report:
    """تحلیل CSV با قوانین نسخهٔ ۱.۰ — همان خروجی و همان پیام‌های خطای اپ اندروید."""
    rep = Report(file_name=file_name, headers=list(headers))
    blacklist = blacklist or set()

    idx = {}
    for i, h in enumerate(headers):
        key = rules.clean_header(h)
        if not key:
            continue
        if key in idx:
            rep.warnings.append(f"ستون تکراری «{h}» — آخرین ستون استفاده می‌شود")
        idx[key] = i

    def find(keys):
        for k in keys:
            if k in idx:
                return idx[k]
        return None

    i_number = find(rules.NUMBER_KEYS)
    if i_number is None:
        raise ValueError(
            "ستون شماره پیدا نشد. نام‌های مجاز:\n  " + rules.allowed_number_headers_text() +
            "\nستون‌های فایل شما: " + " | ".join(headers)
        )
    i_name = find(rules.NAME_KEYS)
    i_first = find(rules.FIRST_KEYS)
    i_last = find(rules.LAST_KEYS)
    i_skip = find(rules.SKIP_KEYS)
    i_delay = find(rules.DELAY_KEYS)
    i_group = find(rules.GROUP_KEYS)
    i_provider = find(rules.PROVIDER_KEYS)

    rep.number_column = headers[i_number]
    rep.name_column = headers[i_name] if i_name is not None else None
    rep.group_column = headers[i_group] if i_group is not None else None
    if i_name is None and i_first is None and i_last is None:
        rep.warnings.append("ستون نام پیدا نشد (اختیاری). برای {name} یک ستون name یا «نام» اضافه کنید.")

    seen = {}
    row_no = 1
    for r in rows:
        row_no += 1
        if not r or all(not (c or "").strip() for c in r):
            continue

        def cell(i):
            if i is None or i >= len(r):
                return ""
            return (r[i] or "").strip()

        raw = cell(i_number)
        num = rules.normalize_number(raw)
        problem = rules.number_problem(raw, num)

        name = cell(i_name) if i_name is not None else ""
        if not name and (i_first is not None or i_last is not None):
            name = (cell(i_first) + " " + cell(i_last)).strip()

        if i_skip is not None and rules.is_truthy(cell(i_skip)):
            rep.skipped += 1
            continue

        if problem:
            rep.invalid.append((row_no, raw, problem))
            continue

        if num in seen:
            rep.duplicates += 1
            continue

        if i_provider is not None:
            declared = cell(i_provider)
            actual = rules.operator_of(num) or ""
            if declared and actual and declared not in actual and actual not in declared:
                if strict_provider:
                    rep.invalid.append((row_no, raw, f"اپراتور اعلام‌شده «{declared}» با پیش‌شماره ({actual}) نمی‌خواند"))
                    continue
                rep.warnings.append(f"ردیف {row_no}: اپراتور «{declared}» با پیش‌شماره «{actual}» نمی‌خواند")

        if num in blacklist:
            rep.skipped += 1
            continue

        fields = {}
        for i, h in enumerate(headers):
            key = rules.clean_header(h)
            if key:
                fields[key] = (r[i] or "").strip() if i < len(r) else ""

        c = Contact(
            row=row_no,
            raw=raw,
            number=num,
            name=name,
            group=cell(i_group),
            delay_ms=int(cell(i_delay)) if cell(i_delay).isdigit() else None,
            fields=fields,
        )
        if rules.is_data_card(num):
            c.status = "SKIPPED"
            c.error = "سیم‌کارت مودم/دیتا (0941) — پیامک نمی‌گیرد"
            rep.warnings.append(f"ردیف {row_no}: {num} سیم‌کارت مودم است و کنار گذاشته شد")
        seen[num] = row_no
        rep.contacts.append(c)

    if not rep.contacts and rep.invalid:
        rep.warnings.append("هیچ شماره معتبری پیدا نشد؛ فایل را بررسی کنید.")
    return rep


def invalid_rows_csv(rep: Report) -> tuple[list, list]:
    return ["سطر", "شماره خام", "دلیل رد شدن"], [
        [r, raw, reason] for (r, raw, reason) in rep.invalid
    ]


def contacts_csv(rep: Report) -> tuple[list, list]:
    headers = ["number", "name", "operator", "status", "error"]
    rows = []
    for c in rep.contacts:
        rows.append([c.number or c.raw, c.name, rules.operator_of(c.number) or "", c.status, c.error])
    return headers, rows


SAMPLE_CSV = (
    "name,number,group,delay_ms\n"
    "علی رضایی,09121234567,مشتری,5000\n"
    "مریم حسینی,09351234568,همکار,5000\n"
    "محمد کریمی,+989121234569,دوست,\n"
    "سارا محمدی,۰۹۱۹۱۲۳۴۵۶۷,,\n"
)

"""سرور جعلی پل گوشی (Mock Phone Bridge)

با این ابزار می‌توانید برنامهٔ ویندوز را **بدون گوشی اندروید** کامل تست کنید:
تحلیل CSV، بارگذاری صف، شروع/توقف، وضعیت زنده و گزارش نتایج — همه با همان
پروتکل پل واقعی (`docs/BRIDGE_API.md`).

اجرا (از پوشهٔ bulksms/windows):
    python tools/mock_phone.py                 # پورت ۸۷۶۵، توکن testtoken
    python tools/mock_phone.py 9000 mytoken    # پورت و توکن دلخواه
    python tools/mock_phone.py 8765 testtoken 0.2 7   # + فاصلهٔ ارسال + خراب کردن هر ۷امین پیام

سپس در برنامهٔ ویندوز: آدرس 127.0.0.1، همان پورت، همان توکن → «تست اتصال».
"""
from __future__ import annotations

import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from payamresan import csvio, rules  # noqa: E402

TOKEN = "testtoken"
PORT = 8765
GAP = 0.15
FAIL_EVERY = 0


class MockEngine:
    """موتور شبیه‌سازی‌شدهٔ ارسال با همان رفتار اپ اندروید."""

    def __init__(self, gap: float = GAP, fail_every: int = FAIL_EVERY):
        self.gap = gap
        self.fail_every = fail_every
        self.lock = threading.Lock()
        self.contacts: list[dict] = []
        self.template = ""
        self.settings: dict = {}
        self.state = "IDLE"
        self.index = 0
        self.sent_run = 0
        self.sent_today = 0
        self.failed = 0
        self.last = "آماده"
        self.dry = False
        self.file_name = ""
        self.thread: threading.Thread | None = None
        self.blacklist: set[str] = set()

    # ---------------------------------------------------------------- queue
    def load(self, contacts, template, settings, file_name=""):
        with self.lock:
            self.contacts = []
            seen = set()
            invalid = []
            for i, c in enumerate(contacts or []):
                raw = str(c.get("number") or "")
                num = rules.normalize_number(raw)
                problem = rules.number_problem(raw, num)
                if problem:
                    invalid.append({"row": c.get("row", i + 2), "value": raw, "reason": problem})
                    continue
                if num in seen:
                    continue
                seen.add(num)
                self.contacts.append({
                    "row": c.get("row", i + 2), "number": num, "raw": raw,
                    "name": c.get("name", ""), "group": c.get("group", ""),
                    "status": "PENDING", "parts": 0, "error": "", "sentAt": 0,
                    "operator": rules.operator_of(num) or "",
                })
            self.template = template or ""
            self.settings = settings or {}
            self.index = 0
            self.sent_run = 0
            self.failed = 0
            self.state = "IDLE"
            self.file_name = file_name
            self.last = f"بارگذاری شد: {len(self.contacts)} مخاطب"
            return {"ok": True, "count": len(self.contacts), "invalid": invalid}

    def start(self):
        with self.lock:
            if self.thread and self.thread.is_alive():
                return
            if not self.contacts:
                self.last = "صف خالی است"
                return
            self.state = "RUNNING"
            self.dry = bool(self.settings.get("dry_run"))
            self.thread = threading.Thread(target=self._loop, daemon=True)
            self.thread.start()

    def _loop(self):
        cap = int(self.settings.get("daily_cap", 200))
        while True:
            with self.lock:
                if self.state != "RUNNING":
                    return
                if self.index >= len(self.contacts):
                    self.state = "DONE"
                    self.last = f"پایان. ارسال‌شده در این اجرا: {self.sent_run}"
                    return
                if self.sent_today >= cap:
                    self.state = "WAITING_QUOTA"
                    self.last = f"سقف روزانه پر شد ({cap})"
                    return
                c = self.contacts[self.index]
                if c["status"] in ("SENT", "SKIPPED"):
                    self.index += 1
                    continue
                text = rules.render_template(self.template, c, self.index)
                c["parts"], gsm = rules.segments(text)
                c["status"] = "SENT"
                c["sentAt"] = int(time.time() * 1000)
                c["error"] = ""
                self.sent_run += 1
                self.sent_today += 1
                if self.fail_every and self.sent_run % self.fail_every == 0:
                    c["status"] = "FAILED"
                    c["error"] = "خطای عمومی مخابراتی (شبیه‌سازی)"
                    self.failed += 1
                    self.last = f"خطا برای {c['number']}"
                else:
                    self.last = f"ارسال شد به {c['name'] or c['number']}"
                self.index += 1
            time.sleep(self.gap)

    def status(self):
        with self.lock:
            done = sum(1 for c in self.contacts if c["status"] == "SENT")
            failed = sum(1 for c in self.contacts if c["status"] == "FAILED")
            return {
                "state": self.state,
                "total": len(self.contacts),
                "done": done,
                "failed": failed,
                "remaining": len(self.contacts) - done - failed,
                "sent_run": self.sent_run,
                "sent_today": self.sent_today,
                "daily_cap": int(self.settings.get("daily_cap", 200)),
                "cursor": self.index,
                "last": self.last,
                "started_at": 0,
                "finished_at": 0,
                "sims": [{"subId": 1, "slot": 0, "name": "سیم ۱ (شبیه‌سازی)", "carrier": "MCI"}],
                "rules_version": rules.RULES_VERSION,
            }

    def results(self):
        with self.lock:
            return [c for c in self.contacts if c["status"] in ("SENT", "FAILED", "SKIPPED")]


ENGINE = MockEngine()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        if os.environ.get("MOCK_VERBOSE"):
            print("  •", args[0] % args[1:])

    # -------------------------------------------------------------- helpers
    def _auth(self):
        if self.headers.get("X-Api-Token") == TOKEN:
            return True
        self._json(401, {"ok": False, "error": "توکن نامعتبر است"})
        return False

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b"{}"
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return {}

    def _path(self):
        return self.path.split("?", 1)[0]

    # ----------------------------------------------------------------- GET
    def do_GET(self):
        p = self._path()
        if p == "/ping":
            return self._json(200, {"ok": True, "app": "payamresan-android", "rules": rules.RULES_VERSION,
                                    "quota_today": ENGINE.sent_today, "state": ENGINE.state,
                                    "mock": True})
        if not self._auth():
            return
        if p == "/status":
            return self._json(200, ENGINE.status())
        if p == "/rules":
            return self._json(200, json.load(open(os.path.join(os.path.dirname(__file__), "..", "..",
                                                              "schema", "contacts.rules.json"), encoding="utf-8")))
        if p == "/sims":
            return self._json(200, {"sims": ENGINE.status()["sims"]})
        if p == "/results":
            return self._json(200, {"ok": True, "count": len(ENGINE.results()),
                                    "results": ENGINE.results(), "state": ENGINE.status()})
        if p == "/metrics":
            days = sorted({time.strftime("%Y-%m-%d", time.localtime(t)) for t in [time.time()]})
            return self._json(200, {"quota_today": ENGINE.sent_today,
                                    "quota_history": [{"date": d, "sent": ENGINE.sent_today} for d in days],
                                    "contacts": ENGINE.results(), "state": ENGINE.status()})
        if p == "/contacts":
            return self._json(200, {"ok": True, "contacts": ENGINE.contacts})
        if p == "/logs":
            return self._json(200, {"logs": [{"name": "sent-mock.csv", "size": 123, "modified": "—"}]})
        if p == "/templates":
            return self._json(200, {"samples": [{"name": "نمونه", "text": "{name} عزیز، سلام"}]})
        if p == "/inbox":
            return self._json(200, {"messages": [
                {"number": "09121234567", "body": "لغو", "date": int(time.time() * 1000), "opt_out": True}]})
        if p == "/optout":
            ENGINE.blacklist.add("09121234567")
            return self._json(200, {"ok": True, "applied": 1, "blacklist": sorted(ENGINE.blacklist)})
        return self._json(404, {"ok": False, "error": "مسیر ناشناخته: " + p})

    # ---------------------------------------------------------------- POST
    def do_POST(self):
        if not self._auth():
            return
        p = self._path()
        body = self._body()
        if p == "/parse":
            try:
                headers, rows, delim = csvio.parse_text(body.get("csv_text", ""))
                rep = csvio.analyze(headers, rows, body.get("file_name", "contacts.csv"))
                return self._json(200, {
                    "ok": True, "file": rep.file_name, "encoding": "UTF-8", "delimiter": delim,
                    "headers": headers, "number_column": rep.number_column, "name_column": rep.name_column,
                    "rows_total": rep.total_rows, "valid": len(rep.valid), "duplicates": rep.duplicates,
                    "invalid_count": len(rep.invalid),
                    "invalid_rows": [{"row": r, "value": v, "reason": w} for r, v, w in rep.invalid],
                    "warnings": rep.warnings,
                })
            except Exception as e:      # noqa: BLE001
                return self._json(200, {"ok": False, "error": str(e)})
        if p == "/send":
            info = ENGINE.load(body.get("contacts"), body.get("template", ""),
                               body.get("settings", {}), body.get("file_name", ""))
            action = (body.get("action") or "load").lower()
            if action == "start":
                ENGINE.start()
            elif action == "pause":
                ENGINE.state = "PAUSED"
            elif action == "resume":
                ENGINE.state = "RUNNING"
            elif action == "stop":
                ENGINE.state = "STOPPED"
            st = ENGINE.status()
            st.update({"ok": True, "loaded": info})
            return self._json(200, st)
        if p.startswith("/send/"):
            action = p.split("/")[-1]
            if action == "start":
                ENGINE.start()
            elif action == "pause":
                ENGINE.state = "PAUSED" if ENGINE.state == "RUNNING" else "RUNNING"
            elif action == "stop":
                ENGINE.state = "STOPPED"
            return self._json(200, {"ok": True, "state": ENGINE.state})
        if p == "/quit":
            threading.Thread(target=self.server.shutdown, daemon=True).start()
            return self._json(200, {"ok": True})
        return self._json(404, {"ok": False, "error": "مسیر ناشناخته: " + p})


def serve(port: int = PORT, token: str = TOKEN, gap: float = GAP, fail_every: int = FAIL_EVERY):
    global TOKEN, PORT, ENGINE
    TOKEN, PORT = token, port
    ENGINE = MockEngine(gap=gap, fail_every=fail_every)
    httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    return httpd


def main(argv=None):
    argv = argv or sys.argv[1:]
    port = int(argv[0]) if len(argv) > 0 else PORT
    token = argv[1] if len(argv) > 1 else TOKEN
    gap = float(argv[2]) if len(argv) > 2 else GAP
    fail_every = int(argv[3]) if len(argv) > 3 else FAIL_EVERY
    httpd = serve(port, token, gap, fail_every)
    print(f"سرور جعلی گوشی فعال شد → http://127.0.0.1:{port}  (توکن: {token})")
    print("در برنامهٔ ویندوز همین آدرس/پورت/توکن را وارد کنید. برای خروج Ctrl+C.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nخاموش شد.")


if __name__ == "__main__":
    main()

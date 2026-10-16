"""کلاینت پل اندروید (PayamResan Bridge) — صحبت با گوشی روی وای‌فای."""
from __future__ import annotations

import json
import socket
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor


class PhoneError(Exception):
    pass


class Phone:
    """اتصال به اپ اندروید؛ همهٔ درخواست‌ها با هدر X-Api-Token."""

    def __init__(self, host: str, port: int = 8765, token: str = "", timeout: float = 15.0):
        self.host = (host or "").strip()
        self.port = int(port)
        self.token = (token or "").strip()
        self.timeout = timeout

    # ------------------------------------------------------------------ utils
    @property
    def base(self) -> str:
        h = self.host
        if not h.startswith("http"):
            h = "http://" + h
        if h.endswith("/"):
            h = h[:-1]
        return f"{h}:{self.port}"

    def _call(self, method: str, path: str, payload=None, timeout=None, auth=True):
        url = self.base + path
        data = None
        headers = {"Accept": "application/json"}
        if auth:
            headers["X-Api-Token"] = self.token
        if payload is not None:
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json; charset=utf-8"
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout or self.timeout) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace") if hasattr(e, "read") else ""
            if e.code == 401:
                raise PhoneError("توکن نامعتبر است. توکنی که اپ گوشی نشان می‌دهد را وارد کنید.") from e
            raise PhoneError(f"خطای HTTP {e.code}: {body[:300]}") from e
        except urllib.error.URLError as e:
            raise PhoneError(f"اتصال به گوشی برقرار نشد ({self.base}). دلیل: {e.reason}") from e
        except socket.timeout as e:
            raise PhoneError("مهلت اتصال تمام شد (timeout) — وای‌فای و آدرس را بررسی کنید") from e
        try:
            return json.loads(raw)
        except json.JSONDecodeError as e:
            raise PhoneError(f"پاسخ نامفهوم از گوشی: {raw[:200]}") from e

    # --------------------------------------------------------------- endpoints
    def ping(self):
        """بدون توکن — برای تست اتصال و جست‌وجو در شبکه."""
        return self._call("GET", "/ping", auth=False, timeout=5)

    def rules(self):
        return self._call("GET", "/rules")

    def sims(self):
        return self._call("GET", "/sims")

    def status(self):
        return self._call("GET", "/status", timeout=8)

    def metrics(self):
        return self._call("GET", "/metrics", timeout=20)

    def results(self):
        return self._call("GET", "/results", timeout=20)

    def templates(self):
        return self._call("GET", "/templates")

    def parse_csv(self, csv_text: str, file_name: str = "contacts.csv", strict_provider: bool = False):
        return self._call("POST", "/parse", {
            "csv_text": csv_text,
            "file_name": file_name,
            "strict_provider": strict_provider,
        }, timeout=60)

    def send(self, contacts, template: str, settings: dict, action: str = "load", file_name: str = ""):
        payload = {
            "contacts": contacts,
            "template": template,
            "settings": settings,
            "action": action,
            "file_name": file_name,
        }
        return self._call("POST", "/send", payload, timeout=120)

    def action(self, what: str):
        return self._call("POST", f"/send/{what}", {}, timeout=20)

    def optouts(self):
        return self._call("GET", "/optout")

    def logs(self):
        return self._call("GET", "/logs")


def discover(port: int = 8765, timeout: float = 4.0, progress=None):
    """جست‌وجوی گوشی در شبکهٔ محلی (اسکن /24 اطراف آدرس خود کامپیوتر)."""
    hosts = local_hosts()
    found = []

    def probe(ip):
        p = Phone(ip, port, timeout=0.7)
        try:
            r = p.ping()
            if r.get("app") == "payamresan-android":
                return (ip, r)
        except Exception:
            return None
        return None

    with ThreadPoolExecutor(max_workers=64) as ex:
        for i, res in enumerate(ex.map(probe, hosts)):
            if progress and i % 16 == 0:
                progress(i, len(hosts))
            if res:
                found.append(res)
    return found


def local_hosts():
    """آدرس‌های /24 اطراف کارت شبکهٔ کامپیوتر."""
    ips = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith("127."):
                ips.add(ip)
    except Exception:
        pass
    # آدرس پیش‌فرض مسیر خروج
    for probe_ip in ("10.255.255.255", "192.168.255.255"):
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.settimeout(0.2)
            s.connect((probe_ip, 1))
            ips.add(s.getsockname()[0])
            s.close()
        except Exception:
            pass
    out = []
    for ip in ips:
        parts = ip.split(".")
        if len(parts) != 4:
            continue
        prefix = ".".join(parts[:3])
        for last in range(1, 255):
            cand = f"{prefix}.{last}"
            if cand != ip:
                out.append(cand)
    return out

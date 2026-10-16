"""PayamResan Desktop — برنامهٔ ویندوز برای تحلیل CSV و کنترل ارسال گروهی با سیم‌کارت گوشی.

معماری: این برنامه پیامک نمی‌فرستد (مودم GSM ندارد). فایل CSV را با همان قوانین
اپ اندروید تحلیل می‌کند، متن پیام و تنظیمات را می‌گیرد و از طریق پل وای‌فای
(POST /send) به گوشی می‌فرستد؛ ارسال واقعی با سیم‌کارت گوشی انجام می‌شود.
"""
from __future__ import annotations

import json
import os
import sys
import threading
import time
from datetime import datetime

from PySide6.QtCore import QObject, Qt, QTimer, Signal
from PySide6.QtGui import QAction, QColor, QFont, QIcon, QTextCursor
from PySide6.QtWidgets import (
    QApplication, QCheckBox, QComboBox, QDialog, QFileDialog, QFormLayout, QFrame,
    QGridLayout, QGroupBox, QHBoxLayout, QLabel, QLineEdit, QListWidget, QMainWindow,
    QMenu, QMessageBox, QPlainTextEdit, QProgressBar, QPushButton, QSpinBox,
    QStatusBar, QSystemTrayIcon, QTabWidget, QTableWidget, QTableWidgetItem,
    QTextBrowser, QVBoxLayout, QWidget,
)

from . import csvio, rules
from .phone import Phone, PhoneError, discover

APP_NAME = "PayamResan Desktop"
APP_VERSION = "1.0.0"

# حالت بی‌سر (تست خودکار/CI): هیچ پنجرهٔ مودالی باز نمی‌شود تا اجرا قفل نکند.
HEADLESS = os.environ.get("PAYAMRESAN_HEADLESS") == "1"

SAMPLES = [
    ("دعوت رسمی",
     "{name} عزیز، سلام.\nاین پیام از طرف مجموعهٔ ما ارسال شده است.\nبا تشکر — برای لغو پاسخ دهید: لغو"),
    ("یادآوری",
     "{name} گرامی، یادآوری می‌کنیم که وقت شما فردا ساعت ۱۷ ثبت شده است.\nلطفاً در صورت عدم امکان، پاسخ دهید."),
    ("اطلاع‌رسانی ساده",
     "سلام {name} جان، خبر تازه‌ای داریم که ممکن است برایتان مهم باشد.\nبرای جزئیات پاسخ دهید."),
    ("متن با شماره",
     "این پیام به شمارهٔ {number} فرستاده شد. (ردیف {index})"),
]

LIMITS_TEXT = """محدودیت‌های واقعی ارسال با سیم‌کارت شخصی (ایران)

• سقف مجاز اپراتورها (همراه اول / ایرانسل / رایتل) برای سیم‌کارت شخصی
  حدود ۲۰۰ تا ۵۰۰ پیامک در هر ۲۴ ساعت است. واحد شمارش «صفحه» است:
  هر پیامک فارسی ۷۰ کاراکتر = یک صفحه، پیامک لاتین ۱۶۰ کاراکتر = یک صفحه.
• با گذشتن از سقف، سیم‌کارت به‌عنوان «مزاحم» محدود یا مسدود می‌شود و
  ممکن است تماس و پیامک شما تا رفع مسدودی قطع شود.
• به همین دلیل در این برنامه: سقف روزانهٔ پیش‌فرض ۲۰۰، فاصلهٔ ارسال
  پیش‌فرض ۵ ثانیه (+نوسان تصادفی) و استراحت هر ۲۰ پیام گذاشته شده است.
• ۱۰۰۰ پیام را در ۳ تا ۵ روز (روزی ۲۰۰ تا ۳۰۰) پخش کنید، نه یک‌جا.
• ارسال تبلیغات انبوه بدون اجازهٔ گیرنده طبق مقررات سازمان تنظیم مقررات
  و ارتباطات رادیویی مجاز نیست. این برنامه برای پیام‌های شخصی، اطلاع‌رسانی
  به مشتریان خودتان و افراد دارای رابطهٔ قبلی ساخته شده است.
• همیشه راه «لغو» در متن پیام بگذارید؛ برنامه پاسخ‌های «لغو/STOP» را
  می‌خواند و شماره را در لیست سیاه می‌گذارد.
"""


def settings_path() -> str:
    base = os.environ.get("APPDATA") or os.path.expanduser("~")
    d = os.path.join(base, "PayamResan")
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, "settings.json")


def resource_path(rel: str) -> str:
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, rel)


class Async(QObject):
    """اجرای درخواست‌های شبکه در نخ جدا تا رابط گرافیکی قطع نشود."""
    ok = Signal(object)
    fail = Signal(str)

    def run(self, fn, *args, **kwargs):
        def work():
            try:
                self.ok.emit(fn(*args, **kwargs))
            except PhoneError as e:
                self.fail.emit(str(e))
            except Exception as e:      # noqa: BLE001
                self.fail.emit(f"{type(e).__name__}: {e}")
        threading.Thread(target=work, daemon=True).start()


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle(f"{APP_NAME} {APP_VERSION} — ارسال گروهی پیامک با سیم‌کارت گوشی")
        self.resize(1150, 820)

        self.cfg = self.load_settings()
        self.rep: csvio.Report | None = None
        self.csv_path = ""
        self.async_jobs = Async()
        self.async_jobs.ok.connect(self.on_async_ok)
        self.async_jobs.fail.connect(self.on_async_fail)
        self.pending_job = ""
        self.seen_results = {}
        self.result_rows = []
        self.out_dir = ""
        self.poll_ticks = 0

        self.build_ui()
        self.build_tray()
        self.restore_settings()

        self.timer = QTimer(self)
        self.timer.timeout.connect(self.poll)
        self.timer.start(1500)

    # ------------------------------------------------------------------ ساخت رابط
    def build_ui(self):
        tabs = QTabWidget()
        tabs.addTab(self.tab_connection(), "۱) اتصال به گوشی")
        tabs.addTab(self.tab_contacts(), "۲) مخاطبین (CSV)")
        tabs.addTab(self.tab_message(), "۳) متن پیام")
        tabs.addTab(self.tab_settings(), "۴) تنظیمات ارسال")
        tabs.addTab(self.tab_send(), "۵) ارسال و گزارش")
        self.setCentralWidget(tabs)
        self.tabs = tabs

        bar = QStatusBar()
        self.lbl_status = QLabel("آماده")
        bar.addWidget(self.lbl_status)
        self.lbl_conn = QLabel("اتصال: برقرار نشده")
        bar.addPermanentWidget(self.lbl_conn)
        self.setStatusBar(bar)

        menu = self.menuBar()
        m_file = menu.addMenu("فایل")
        act_open = QAction("باز کردن CSV…", self)
        act_open.triggered.connect(self.pick_csv)
        m_file.addAction(act_open)
        act_sample = QAction("ساخت نمونهٔ CSV…", self)
        act_sample.triggered.connect(self.save_sample_csv)
        m_file.addAction(act_sample)
        m_file.addSeparator()
        act_quit = QAction("خروج", self)
        act_quit.triggered.connect(self.close)
        m_file.addAction(act_quit)

        m_tools = menu.addMenu("ابزار")
        act_disc = QAction("جست‌وجوی گوشی در شبکه", self)
        act_disc.triggered.connect(self.discover_phone)
        m_tools.addAction(act_disc)
        act_test = QAction("تست اتصال", self)
        act_test.triggered.connect(self.test_connection)
        m_tools.addAction(act_test)
        act_stop = QAction("توقف فوری ارسال", self)
        act_stop.triggered.connect(lambda: self.phone_action("stop"))
        m_tools.addAction(act_stop)

        m_help = menu.addMenu("راهنما")
        act_rules = QAction("قوانین CSV و ستون‌ها", self)
        act_rules.triggered.connect(self.show_rules)
        m_help.addAction(act_rules)
        act_limits = QAction("محدودیت‌های قانونی و سقف پیامک", self)
        act_limits.triggered.connect(self.show_limits)
        m_help.addAction(act_limits)

    def tab_connection(self) -> QWidget:
        w = QWidget()
        v = QVBoxLayout(w)

        box = QGroupBox("پل گوشی (PayamResan Bridge)")
        form = QFormLayout(box)
        hb = QHBoxLayout()
        self.ed_host = QLineEdit()
        self.ed_host.setPlaceholderText("مثلاً 192.168.1.45")
        self.sp_port = QSpinBox()
        self.sp_port.setRange(1, 65535)
        self.sp_port.setValue(8765)
        hb.addWidget(self.ed_host, 3)
        hb.addWidget(QLabel("پورت:"))
        hb.addWidget(self.sp_port, 1)
        form.addRow("آدرس گوشی:", hb)

        hb2 = QHBoxLayout()
        self.ed_token = QLineEdit()
        self.ed_token.setPlaceholderText("توکنی که در اپ گوشی نمایش داده می‌شود (مثلاً k3f9x2m0q7)")
        hb2.addWidget(self.ed_token)
        form.addRow("توکن:", hb2)

        hb3 = QHBoxLayout()
        self.btn_test = QPushButton("تست اتصال")
        self.btn_test.clicked.connect(self.test_connection)
        self.btn_discover = QPushButton("جست‌وجو در شبکهٔ وای‌فای")
        self.btn_discover.clicked.connect(self.discover_phone)
        hb3.addWidget(self.btn_test)
        hb3.addWidget(self.btn_discover)
        hb3.addStretch(1)
        form.addRow("", hb3)
        v.addWidget(box)

        box2 = QGroupBox("وضعیت گوشی")
        vv = QVBoxLayout(box2)
        self.lbl_phone = QLabel("—")
        self.lbl_phone.setWordWrap(True)
        vv.addWidget(self.lbl_phone)
        self.lbl_quota = QLabel("سقف امروز: —")
        vv.addWidget(self.lbl_quota)
        self.tbl_quota = QTableWidget(0, 2)
        self.tbl_quota.setHorizontalHeaderLabels(["تاریخ", "تعداد پیامک ارسال‌شده"])
        self.tbl_quota.horizontalHeader().setStretchLastSection(True)
        self.tbl_quota.setMaximumHeight(200)
        vv.addWidget(self.tbl_quota)
        btn_opt = QPushButton("خواندن صندوق پیام و اعمال «لغو»ها در لیست سیاه")
        btn_opt.clicked.connect(self.apply_optouts)
        vv.addWidget(btn_opt)
        v.addWidget(box2)
        v.addStretch(1)

        steps = QLabel(
            "سه قدم راه‌اندازی:\n"
            "۱. اپ اندروید را در گوشی نصب و باز کنید؛ دسترسی‌های «ارسال پیامک» و «تلفن» را بدهید.\n"
            "۲. در تب «۵» اپ گوشی، «روشن کردن پل» را بزنید؛ آدرس و توکن نمایش داده می‌شود.\n"
            "۳. همان آدرس و توکن را اینجا وارد کنید و «تست اتصال» را بزنید.\n"
            "گوشی و کامپیوتر باید به یک وای‌فای وصل باشند (بدون VPN)."
        )
        steps.setWordWrap(True)
        steps.setFrameShape(QFrame.StyledPanel)
        v.addWidget(steps)
        return w

    def tab_contacts(self) -> QWidget:
        w = QWidget()
        v = QVBoxLayout(w)
        hb = QHBoxLayout()
        self.btn_pick = QPushButton("انتخاب فایل CSV…")
        self.btn_pick.clicked.connect(self.pick_csv)
        self.btn_reload = QPushButton("بازخوانی همین فایل")
        self.btn_reload.clicked.connect(lambda: self.load_csv(self.csv_path) if self.csv_path else None)
        self.btn_export_invalid = QPushButton("ذخیرهٔ ردیف‌های نامعتبر")
        self.btn_export_invalid.clicked.connect(self.export_invalid)
        self.btn_export_clean = QPushButton("ذخیرهٔ لیست تمیز")
        self.btn_export_clean.clicked.connect(self.export_clean)
        hb.addWidget(self.btn_pick)
        hb.addWidget(self.btn_reload)
        hb.addWidget(self.btn_export_invalid)
        hb.addWidget(self.btn_export_clean)
        hb.addStretch(1)
        v.addLayout(hb)

        self.lbl_csv = QLabel("فایلی انتخاب نشده است.")
        self.lbl_csv.setWordWrap(True)
        v.addWidget(self.lbl_csv)

        self.tbl = QTableWidget(0, 6)
        self.tbl.setHorizontalHeaderLabels(["سطر", "شماره (نرمال‌شده)", "نام", "گروه", "اپراتور", "وضعیت"])
        self.tbl.horizontalHeader().setStretchLastSection(True)
        v.addWidget(self.tbl, 1)
        return w

    def tab_message(self) -> QWidget:
        w = QWidget()
        v = QVBoxLayout(w)
        hb = QHBoxLayout()
        hb.addWidget(QLabel("قالب آماده:"))
        self.cmb_samples = QComboBox()
        self.cmb_samples.addItem("— انتخاب کنید —")
        for name, _ in SAMPLES:
            self.cmb_samples.addItem(name)
        self.cmb_samples.currentIndexChanged.connect(self.apply_sample)
        hb.addWidget(self.cmb_samples, 1)
        hb.addWidget(QLabel("درج متغیر:"))
        self.cmb_tokens = QComboBox()
        self.cmb_tokens.addItems(["— متغیرها —"])
        self.cmb_tokens.currentIndexChanged.connect(self.insert_token)
        hb.addWidget(self.cmb_tokens, 1)
        v.addLayout(hb)

        self.edt_template = QPlainTextEdit()
        self.edt_template.setPlaceholderText(
            "متن پیام… می‌توانید از {name} {number} {group} {index} و نام هر ستون CSV استفاده کنید."
        )
        f = QFont("Vazirmatn", 12)
        self.edt_template.setFont(f)
        self.edt_template.textChanged.connect(self.update_preview)
        v.addWidget(self.edt_template, 1)

        self.lbl_preview = QLabel("پیش‌نمایش: —")
        self.lbl_preview.setWordWrap(True)
        self.lbl_preview.setFrameShape(QFrame.StyledPanel)
        v.addWidget(self.lbl_preview)
        return w

    def tab_settings(self) -> QWidget:
        w = QWidget()
        g = QGridLayout(w)
        r = 0

        g.addWidget(QLabel("سیم‌کارت ارسال:"), r, 0)
        hb = QHBoxLayout()
        self.cmb_sim = QComboBox()
        self.btn_refresh_sims = QPushButton("خواندن از گوشی")
        self.btn_refresh_sims.clicked.connect(self.refresh_sims)
        hb.addWidget(self.cmb_sim, 1)
        hb.addWidget(self.btn_refresh_sims)
        g.addLayout(hb, r, 1)
        r += 1

        def spin(label, value, lo, hi, suffix=""):
            nonlocal r
            sp = QSpinBox()
            sp.setRange(lo, hi)
            sp.setValue(value)
            if suffix:
                sp.setSuffix(" " + suffix)
            g.addWidget(QLabel(label), r, 0)
            g.addWidget(sp, r, 1)
            r += 1
            return sp

        self.sp_gap = spin("فاصلهٔ بین پیام‌ها (ثانیه)", 5, 1, 600, "ثانیه")
        self.sp_jitter = spin("نوسان تصادفی (ثانیه)", 3, 0, 120, "ثانیه")
        self.sp_batch = spin("تعداد هر دسته", 20, 1, 200)
        self.sp_pause = spin("استراحت بین دسته‌ها", 300, 10, 7200, "ثانیه")
        self.sp_cap = spin("سقف پیام در ۲۴ ساعت", 200, 1, 2000)

        hb2 = QHBoxLayout()
        self.chk_window = QCheckBox("فقط در بازهٔ ساعتی مشخص ارسال کن")
        self.sp_wstart = QSpinBox(); self.sp_wstart.setRange(0, 23); self.sp_wstart.setValue(9)
        self.sp_wend = QSpinBox(); self.sp_wend.setRange(1, 24); self.sp_wend.setValue(21)
        hb2.addWidget(self.chk_window)
        hb2.addWidget(QLabel("از ساعت"))
        hb2.addWidget(self.sp_wstart)
        hb2.addWidget(QLabel("تا ساعت"))
        hb2.addWidget(self.sp_wend)
        g.addLayout(hb2, r, 0, 1, 2)
        r += 1

        self.chk_strict = QCheckBox("حالت سخت‌گیرانه: ستون اپراتور باید با پیش‌شماره بخواند (ردیف مغایر رد شود)")
        self.chk_auto = QCheckBox("پس از پر شدن سقف روزانه، خودکار فردا ادامه بده")
        self.chk_retry = QCheckBox("تلاش دوباره برای مخاطبین خطادار هنگام شروع بعدی")
        self.chk_reports = QCheckBox("درخواست گزارش تحویل از شبکه (Delivery Report)")
        self.chk_reports.setChecked(True)
        for c in (self.chk_strict, self.chk_auto, self.chk_retry, self.chk_reports):
            g.addWidget(c, r, 0, 1, 2)
            r += 1

        btn = QPushButton("ذخیرهٔ تنظیمات")
        btn.clicked.connect(lambda: (self.save_settings(), self.say("تنظیمات ذخیره شد")))
        g.addWidget(btn, r, 0, 1, 2)
        r += 1

        btn_send_cfg = QPushButton("ارسال قالب و تنظیمات به گوشی (بدون شروع ارسال)")
        btn_send_cfg.clicked.connect(lambda: self.push_config(start=False))
        g.addWidget(btn_send_cfg, r, 0, 1, 2)
        g.setRowStretch(r + 1, 1)
        return w

    def tab_send(self) -> QWidget:
        w = QWidget()
        v = QVBoxLayout(w)
        hb = QHBoxLayout()
        self.btn_start = QPushButton("▶ شروع ارسال")
        self.btn_start.setMinimumHeight(46)
        self.btn_start.setStyleSheet("background:#12A150;color:white;font-weight:bold;font-size:15px")
        self.btn_start.clicked.connect(lambda: self.confirm_and_start())
        self.btn_pause = QPushButton("⏸ توقف/ادامه")
        self.btn_pause.clicked.connect(self.toggle_pause)
        self.btn_stop = QPushButton("■ توقف کامل")
        self.btn_stop.clicked.connect(lambda: self.phone_action("stop"))
        self.btn_sim = QPushButton("شبیه‌سازی (بدون ارسال)")
        self.btn_sim.clicked.connect(self.simulate)
        for b in (self.btn_start, self.btn_pause, self.btn_stop, self.btn_sim):
            hb.addWidget(b)
        v.addLayout(hb)

        self.progress = QProgressBar()
        v.addWidget(self.progress)

        self.lbl_progress = QLabel("وضعیت: آماده")
        v.addWidget(self.lbl_progress)

        hb3 = QHBoxLayout()
        self.btn_export = QPushButton("ذخیرهٔ گزارش CSV")
        self.btn_export.clicked.connect(self.export_results)
        self.btn_clearlog = QPushButton("پاک کردن لاگ")
        self.btn_clearlog.clicked.connect(lambda: self.edt_log.clear())
        hb3.addWidget(self.btn_export)
        hb3.addWidget(self.btn_clearlog)
        hb3.addWidget(QLabel("پوشهٔ خروجی:"))
        self.edt_out = QLineEdit()
        self.edt_out.setPlaceholderText("کنار فایل CSV ساخته می‌شود: payamresan-out")
        hb3.addWidget(self.edt_out, 1)
        v.addLayout(hb3)

        self.edt_log = QPlainTextEdit()
        self.edt_log.setReadOnly(True)
        self.edt_log.setFont(QFont("Consolas", 10))
        v.addWidget(self.edt_log, 1)
        return w

    # -------------------------------------------------------------------- tray
    def build_tray(self):
        if HEADLESS:
            self.tray = None
            return
        icon_path = resource_path(os.path.join("payamresan", "icon.png"))
        if os.path.exists(icon_path):
            self.setWindowIcon(QIcon(icon_path))
        self.tray = QSystemTrayIcon(self.windowIcon(), self) if QSystemTrayIcon.isSystemTrayAvailable() else None
        if self.tray:
            menu = QMenu()
            a_show = QAction("نمایش پنجره", self)
            a_show.triggered.connect(self.showNormal)
            a_stop = QAction("توقف ارسال", self)
            a_stop.triggered.connect(lambda: self.phone_action("stop"))
            a_quit = QAction("خروج", self)
            a_quit.triggered.connect(self.close)
            menu.addAction(a_show)
            menu.addAction(a_stop)
            menu.addSeparator()
            menu.addAction(a_quit)
            self.tray.setContextMenu(menu)
            self.tray.setToolTip(APP_NAME)
            self.tray.show()

    # ------------------------------------------------------------- تنظیمات
    def load_settings(self) -> dict:
        try:
            with open(settings_path(), encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}

    def save_settings(self):
        cfg = {
            "host": self.ed_host.text().strip(),
            "port": self.sp_port.value(),
            "token": self.ed_token.text().strip(),
            "template": self.edt_template.toPlainText(),
            "gap": self.sp_gap.value(),
            "jitter": self.sp_jitter.value(),
            "batch": self.sp_batch.value(),
            "pause": self.sp_pause.value(),
            "cap": self.sp_cap.value(),
            "window": self.chk_window.isChecked(),
            "wstart": self.sp_wstart.value(),
            "wend": self.sp_wend.value(),
            "strict": self.chk_strict.isChecked(),
            "auto_next_day": self.chk_auto.isChecked(),
            "retry": self.chk_retry.isChecked(),
            "reports": self.chk_reports.isChecked(),
            "out": self.edt_out.text().strip(),
            "sim_index": self.cmb_sim.currentIndex(),
        }
        try:
            with open(settings_path(), "w", encoding="utf-8") as f:
                json.dump(cfg, f, ensure_ascii=False, indent=2)
        except Exception as e:      # noqa: BLE001
            self.warn(f"ذخیرهٔ تنظیمات ناموفق بود: {e}")
        return cfg

    def restore_settings(self):
        c = self.cfg
        self.ed_host.setText(c.get("host", ""))
        self.sp_port.setValue(int(c.get("port", 8765)))
        self.ed_token.setText(c.get("token", ""))
        self.edt_template.setPlainText(c.get("template", SAMPLES[0][1]))
        self.sp_gap.setValue(int(c.get("gap", 5)))
        self.sp_jitter.setValue(int(c.get("jitter", 3)))
        self.sp_batch.setValue(int(c.get("batch", 20)))
        self.sp_pause.setValue(int(c.get("pause", 300)))
        self.sp_cap.setValue(int(c.get("cap", 200)))
        self.chk_window.setChecked(bool(c.get("window", False)))
        self.sp_wstart.setValue(int(c.get("wstart", 9)))
        self.sp_wend.setValue(int(c.get("wend", 21)))
        self.chk_strict.setChecked(bool(c.get("strict", False)))
        self.chk_auto.setChecked(bool(c.get("auto_next_day", False)))
        self.chk_retry.setChecked(bool(c.get("retry", False)))
        self.chk_reports.setChecked(bool(c.get("reports", True)))
        self.edt_out.setText(c.get("out", ""))
        self.cmb_sim.addItem("پیش‌فرض گوشی")
        self.update_preview()

    # ------------------------------------------------------------------ ابزار
    def say(self, msg: str):
        self.lbl_status.setText(msg)
        self.log(msg)

    def log(self, msg: str):
        ts = datetime.now().strftime("%H:%M:%S")
        self.edt_log.appendPlainText(f"[{ts}] {msg}")
        self.edt_log.moveCursor(QTextCursor.End)

    def warn(self, msg: str):
        if HEADLESS:
            self.log("[headless][warn] " + msg.replace("\n", " / "))
            return
        QMessageBox.warning(self, "هشدار", msg)

    def info(self, msg: str, title="اطلاع"):
        if HEADLESS:
            self.log("[headless][info] " + msg.replace("\n", " / "))
            return
        QMessageBox.information(self, title, msg)

    def phone(self) -> Phone:
        return Phone(self.ed_host.text().strip(), self.sp_port.value(), self.ed_token.text().strip())

    # ------------------------------------------------------- اتصال و وضعیت
    def test_connection(self):
        self.say("در حال تست اتصال…")
        self.pending_job = "ping"
        self.async_jobs.run(self.phone().ping)

    def discover_phone(self):
        self.say("جست‌وجو در شبکه… (چند ثانیه طول می‌کشد)")
        port = self.sp_port.value()

        def work():
            found = discover(port)
            return [{"ip": ip, "info": info} for ip, info in found]

        self.pending_job = "discover"
        self.async_jobs.run(work)

    def refresh_sims(self):
        self.pending_job = "sims"
        self.async_jobs.run(self.phone().sims)

    def apply_optouts(self):
        self.pending_job = "optout"
        self.async_jobs.run(self.phone().optouts)

    def poll(self):
        if not self.ed_host.text().strip():
            return
        self.poll_ticks += 1
        self.pending_job = "status"
        self.async_jobs.run(self.phone().status)

    def on_async_ok(self, data):
        job, self.pending_job = self.pending_job, ""
        if job == "ping":
            self.info(
                f"اتصال برقرار شد ✅\n\n"
                f"برنامهٔ گوشی: {data.get('app')}\n"
                f"نسخهٔ قوانین: {data.get('rules')}\n"
                f"وضعیت موتور: {data.get('state')}\n"
                f"ارسال‌شده امروز (گوشی): {data.get('quota_today')}",
                "تست اتصال"
            )
            self.lbl_conn.setText("اتصال: ✅ برقرار")
            self.refresh_sims()
        elif job == "discover":
            if not data:
                self.warn("گوشی پیدا نشد. مطمئن شوید اپ گوشی باز است، «پل» روشن است و هر دو دستگاه به یک وای‌فای وصل‌اند (VPN خاموش).")
                return
            ip = data[0]["ip"]
            self.ed_host.setText(ip)
            self.say(f"گوشی پیدا شد: {ip} — حالا توکن اپ گوشی را وارد کنید و «تست اتصال» را بزنید.")
        elif job == "sims":
            sims = data.get("sims", [])
            self.cmb_sim.clear()
            for s in sims:
                label = f"سیم {int(s.get('slot', 0)) + 1}: {s.get('name', '')}"
                if s.get("carrier"):
                    label += f" ({s['carrier']})"
                self.cmb_sim.addItem(label, s.get("subId", -1))
            if not sims:
                self.cmb_sim.addItem("پیش‌فرض گوشی", -1)
            self.cmb_sim.setCurrentIndex(min(self.cfg.get("sim_index", 0), self.cmb_sim.count() - 1))
        elif job == "status":
            self.apply_status(data)
        elif job == "metrics":
            self.apply_metrics(data)
        elif job == "results":
            self.apply_results(data)
        elif job == "optout":
            self.info(f"{data.get('applied', 0)} شمارهٔ «لغو» به لیست سیاه اضافه شد.\n"
                      f"تعداد کل لیست سیاه: {len(data.get('blacklist', []))}", "لغو/لیست سیاه")
        elif job == "config":
            self.say("قالب و تنظیمات به گوشی ارسال شد")
        elif job == "start":
            self.say("ارسال در گوشی آغاز شد")
            self.log(f"شروع: {json.dumps(data, ensure_ascii=False)[:300]}")
        elif job == "pause":
            self.say("وضعیت توقف تغییر کرد")
        elif job == "stop":
            self.say("ارسال متوقف شد")

    def on_async_fail(self, msg):
        self.pending_job = ""
        self.lbl_conn.setText("اتصال: ⚠ قطع")
        if not self.edt_log.toPlainText().endswith(msg):
            self.log("خطا: " + msg)

    def apply_status(self, data: dict):
        self.lbl_conn.setText("اتصال: ✅ برقرار")
        total = int(data.get("total", 0))
        done = int(data.get("done", 0))
        failed = int(data.get("failed", 0))
        self.progress.setMaximum(max(total, 1))
        self.progress.setValue(done)
        state_fa = {
            "IDLE": "آماده", "RUNNING": "در حال ارسال", "PAUSED": "توقف موقت",
            "WAITING_QUOTA": "انتظار سقف روزانه", "WAITING_WINDOW": "انتظار بازهٔ ساعتی",
            "DONE": "پایان یافت", "STOPPED": "متوقف",
        }.get(data.get("state", ""), data.get("state", ""))
        self.lbl_progress.setText(
            f"وضعیت گوشی: {state_fa} — {data.get('last', '')}\n"
            f"کل: {total} • ارسال‌شده: {done} • خطا: {failed} • باقی‌مانده: {data.get('remaining', 0)} • "
            f"این اجرا: {data.get('sent_run', 0)} • امروز: {data.get('sent_today', 0)}"
        )
        try:
            self.tray.setToolTip(f"{APP_NAME}\n{state_fa} — {done}/{total}")
        except Exception:
            pass
        self.lbl_phone.setText(
            f"وضعیت موتور گوشی: {state_fa}\nآخرین پیام: {data.get('last', '')}"
        )
        if self.poll_ticks % 4 == 0:
            self.pending_job = "results"
            self.async_jobs.run(self.phone().results)
        if self.poll_ticks % 20 == 0:
            self.pending_job = "metrics"
            self.async_jobs.run(self.phone().metrics)

    def apply_metrics(self, data: dict):
        rows = data.get("quota_history", [])
        self.tbl_quota.setRowCount(len(rows))
        for i, r in enumerate(rows):
            self.tbl_quota.setItem(i, 0, QTableWidgetItem(str(r.get("date", ""))))
            self.tbl_quota.setItem(i, 1, QTableWidgetItem(str(r.get("sent", 0))))
        self.lbl_quota.setText(f"سقف امروز: {data.get('quota_today', 0)} پیام در ۲۴ ساعت گذشته (از گوشی)")

    def apply_results(self, data: dict):
        results = data.get("results", [])
        for r in results:
            key = r.get("number") or r.get("raw")
            status = r.get("status")
            prev = self.seen_results.get(key)
            if prev == status:
                continue
            self.seen_results[key] = status
            line = f"{r.get('name', '')} • {key} → {status}" + (f" ({r.get('error')})" if r.get("error") else "")
            self.log(line)
            self.result_rows.append([
                datetime.now().strftime("%Y-%m-%d %H:%M:%S"), key, r.get("name", ""),
                r.get("operator", ""), status, r.get("parts", 0), r.get("error") or "",
            ])
        if results:
            self.write_results_csv()
            # به‌روزرسانی جدول مخاطبین
            for i in range(self.tbl.rowCount()):
                num_item = self.tbl.item(i, 1)
                if not num_item:
                    continue
                st = self.seen_results.get(num_item.text())
                if st:
                    self.tbl.setItem(i, 5, QTableWidgetItem(st))

    def write_results_csv(self):
        if not self.result_rows or not self.out_dir:
            return
        try:
            path = os.path.join(self.out_dir, f"results-{datetime.now().strftime('%Y-%m-%d')}.csv")
            csvio.write_file(
                path,
                ["time", "number", "name", "operator", "status", "parts", "error"],
                self.result_rows,
            )
        except Exception as e:      # noqa: BLE001
            self.log(f"لاگ‌گیری ناموفق: {e}")

    # ------------------------------------------------------------ CSV و پیام
    def pick_csv(self):
        path, _ = QFileDialog.getOpenFileName(self, "انتخاب فایل مخاطبین", "", "CSV (*.csv *.txt);;همهٔ فایل‌ها (*)")
        if path:
            self.load_csv(path)

    def load_csv(self, path: str):
        try:
            headers, rows, delim, enc = csvio.read_file(path)
            rep = csvio.analyze(
                headers, rows, os.path.basename(path),
                strict_provider=self.chk_strict.isChecked(),
            )
        except Exception as e:      # noqa: BLE001
            self.warn(f"خواندن فایل ناموفق بود:\n{e}")
            return
        self.rep = rep
        self.csv_path = path
        self.out_dir = self.edt_out.text().strip() or os.path.join(
            os.path.dirname(os.path.abspath(path)), "payamresan-out"
        )
        os.makedirs(self.out_dir, exist_ok=True)

        self.lbl_csv.setText(
            f"فایل: {path}\n"
            f"ستون شماره: «{rep.number_column}»   |   ستون نام: «{rep.name_column or '—'}»   |   "
            f"جداکننده: «{rep.delimiter}»   |   انکودینگ: {enc}\n"
            f"کل ردیف‌ها: {rep.total_rows}   ✅ معتبر: {len(rep.valid)}   "
            f"❌ نامعتبر: {len(rep.invalid)}   ♻ تکراری: {rep.duplicates}   ⏭ ردشده: {rep.skipped}"
        )
        warnings = rep.warnings + [
            f"ستون‌های موجود: {' | '.join(headers)}",
        ]
        self.log(" | ".join(warnings))

        self.fill_table(rep)
        self.refresh_tokens(rep)
        self.update_preview()
        self.tabs.setCurrentIndex(1)
        self.say(f"تحلیل شد: {len(rep.valid)} مخاطب آمادهٔ ارسال")
        if rep.invalid:
            self.info(
                f"{len(rep.invalid)} ردیف رد شد.\n"
                f"نمونه:\n" + "\n".join(f"• سطر {r}: «{v}» — {why}" for r, v, why in rep.invalid[:10]) +
                "\n\nبا دکمهٔ «ذخیرهٔ ردیف‌های نامعتبر» فایل کامل خطاها را بگیرید.",
                "ردیف‌های نامعتبر"
            )

    def fill_table(self, rep: csvio.Report):
        limit = 3000
        self.tbl.setRowCount(min(len(rep.contacts), limit))
        for i, c in enumerate(rep.contacts[:limit]):
            vals = [str(c.row), c.number or c.raw, c.name, c.group, rules.operator_of(c.number) or "", c.status]
            for j, val in enumerate(vals):
                item = QTableWidgetItem(val)
                if c.status == "SKIPPED":
                    item.setForeground(QColor("#b45309"))
                self.tbl.setItem(i, j, item)
        self.tbl.resizeColumnsToContents()

    def refresh_tokens(self, rep: csvio.Report):
        tokens = []
        for h in rep.headers:
            k = rules.clean_header(h)
            if k:
                tokens.append("{" + k + "}")
        tokens += ["{" + t + "}" for t in rules.BUILTIN_PLACEHOLDERS]
        self.cmb_tokens.blockSignals(True)
        self.cmb_tokens.clear()
        self.cmb_tokens.addItems(["— متغیرها —"] + sorted(set(tokens)))
        self.cmb_tokens.blockSignals(False)

    def insert_token(self, idx: int):
        if idx <= 0:
            return
        tok = self.cmb_tokens.itemText(idx)
        self.edt_template.insertPlainText(tok)
        self.cmb_tokens.setCurrentIndex(0)

    def apply_sample(self, idx: int):
        if idx <= 0:
            return
        self.edt_template.setPlainText(SAMPLES[idx - 1][1])
        self.cmb_samples.setCurrentIndex(0)

    def update_preview(self):
        text = self.edt_template.toPlainText()
        rep = self.rep
        sample = rep.contacts[0] if rep and rep.contacts else {
            "name": "نمونه", "number": "09121234567", "raw": "09121234567", "group": "", "fields": {}
        }
        rendered = rules.render_template(text, sample, 0)
        parts, gsm = rules.segments(rendered)
        enc = "GSM-7 (لاتین)" if gsm else "یونیکد UTF-16 (فارسی/غیرلاتین)"
        self.lbl_preview.setText(
            f"پیش‌نمایش برای «{sample.get('name') or 'نمونه'}»:\n{rendered}\n\n"
            f"طول: {len(rendered)} کاراکتر • تعداد پیامک: {parts} • کدگذاری: {enc}"
            + ("\n⚠ متن بیش از یک پیامک است و اعتبار بیشتری مصرف می‌کند." if parts > 1 else "")
        )

    def save_sample_csv(self):
        path, _ = QFileDialog.getSaveFileName(self, "ذخیرهٔ نمونهٔ CSV", "sample-contacts.csv", "CSV (*.csv)")
        if not path:
            return
        try:
            with open(path, "w", encoding="utf-8-sig", newline="") as f:
                f.write(csvio.SAMPLE_CSV)
            self.info(f"ساخته شد:\n{path}\n\nساختار: name,number,group,delay_ms\n"
                      "(معادل فارسی: نام,شماره,گروه)", "نمونهٔ CSV")
        except Exception as e:      # noqa: BLE001
            self.warn(str(e))

    def export_invalid(self):
        if not self.rep or not self.rep.invalid:
            self.warn("ردیف نامعتبری وجود ندارد.")
            return
        headers, rows = csvio.invalid_rows_csv(self.rep)
        path, _ = QFileDialog.getSaveFileName(self, "ذخیرهٔ ردیف‌های نامعتبر", "invalid-rows.csv", "CSV (*.csv)")
        if path:
            csvio.write_file(path, headers, rows)
            self.say(f"ذخیره شد: {path}")

    def export_clean(self):
        if not self.rep:
            self.warn("اول یک فایل انتخاب کنید.")
            return
        headers, rows = csvio.contacts_csv(self.rep)
        path, _ = QFileDialog.getSaveFileName(self, "ذخیرهٔ لیست تمیز", "clean-contacts.csv", "CSV (*.csv)")
        if path:
            csvio.write_file(path, headers, rows)
            self.say(f"ذخیره شد: {path}")

    def export_results(self):
        if not self.result_rows:
            self.warn("گزارشی برای ذخیره وجود ندارد.")
            return
        path, _ = QFileDialog.getSaveFileName(self, "ذخیرهٔ گزارش", "report.csv", "CSV (*.csv)")
        if path:
            csvio.write_file(path, ["time", "number", "name", "operator", "status", "parts", "error"], self.result_rows)
            self.say(f"گزارش ذخیره شد: {path}")

    # ------------------------------------------------------------------ ارسال
    def settings_payload(self) -> dict:
        return {
            "gap_ms": self.sp_gap.value() * 1000,
            "jitter_ms": self.sp_jitter.value() * 1000,
            "batch_size": self.sp_batch.value(),
            "long_pause_ms": self.sp_pause.value() * 1000,
            "daily_cap": self.sp_cap.value(),
            "sub_id": self.cmb_sim.currentData() if self.cmb_sim.currentData() is not None else -1,
            "delivery_report": self.chk_reports.isChecked(),
            "dry_run": False,
            "auto_continue_next_day": self.chk_auto.isChecked(),
            "retry_failed": self.chk_retry.isChecked(),
            "window": {
                "enabled": self.chk_window.isChecked(),
                "start_hour": self.sp_wstart.value(),
                "end_hour": self.sp_wend.value(),
            },
        }

    def push_config(self, start: bool):
        if not self.rep:
            self.warn("اول فایل CSV را انتخاب کنید.")
            return
        contacts = [c.as_json() for c in self.rep.contacts if c.status == "PENDING"]
        if not contacts:
            self.warn("مخاطب معتبری برای ارسال وجود ندارد.")
            return
        cfg = self.save_settings()
        self.log(f"ارسال {len(contacts)} مخاطب به گوشی…")
        self.pending_job = "start" if start else "config"
        self.async_jobs.run(
            self.phone().send,
            contacts,
            self.edt_template.toPlainText(),
            self.settings_payload(),
            "start" if start else "load",
            os.path.basename(self.csv_path),
        )

    def confirm_and_start(self):
        if not self.rep:
            self.warn("اول فایل CSV را انتخاب کنید.")
            return
        pending = len(self.rep.valid)
        cap = self.sp_cap.value()
        gap = self.sp_gap.value() + self.sp_jitter.value() / 2
        per_batch = self.sp_batch.value()
        pause = self.sp_pause.value()
        tonight = min(pending, cap)
        secs = tonight * gap + (tonight / max(per_batch, 1)) * pause
        hours = secs / 3600
        days = max(1, -(-pending // max(cap, 1)))
        msg = (
            f"مخاطب آمادهٔ ارسال: {pending}\n"
            f"سقف روزانه: {cap} پیام\n"
            f"سقف امروز: {tonight} پیام → حدود {hours:.1f} ساعت\n"
            f"با این سقف، کل {pending} مخاطب در {days} روز تمام می‌شود.\n\n"
            f"فاصلهٔ هر پیام: {self.sp_gap.value()} ثانیه (+ نوسان {self.sp_jitter.value()} ثانیه)\n"
            f"هر {per_batch} پیام: استراحت {pause} ثانیه\n\n"
            "ارسال با سیم‌کارت گوشی آغاز شود؟\n"
            "پس از شروع، برنامه را باز نگه دارید؛ گوشی به شبکهٔ GSM وصل بماند."
        )
        if HEADLESS:
            self.log("[headless] تأیید شروع ارسال رد شد (حالت بی‌سر)")
            return
        if QMessageBox.question(self, "تأیید شروع ارسال", msg) == QMessageBox.Yes:
            self.push_config(start=True)

    def toggle_pause(self):
        cur = self.lbl_progress.text()
        action = "resume" if "توقف موقت" in cur else "pause"
        self.phone_action(action)

    def phone_action(self, action: str):
        self.pending_job = action
        self.async_jobs.run(self.phone().action, action)

    def simulate(self):
        if not self.rep or not self.rep.valid:
            self.warn("اول فایل CSV را انتخاب کنید.")
            return
        tpl = self.edt_template.toPlainText()
        gap = self.sp_gap.value() + self.sp_jitter.value() / 2
        rows = []
        for c in self.rep.valid[:5]:
            text = rules.render_template(tpl, c, 0)
            parts, gsm = rules.segments(text)
            rows.append(f"— {c.number} ({c.name or 'بی‌نام'}، {rules.operator_of(c.number)})\n"
                        f"   {text.splitlines()[0] if text else ''}" + (f"…" if len(text.splitlines()) > 1 else "") +
                        f"\n   [{len(text)} کاراکتر، {parts} پیامک، {'GSM-7' if gsm else 'Unicode'}]")
        total_secs = len(self.rep.valid) * gap + (len(self.rep.valid) // max(self.sp_batch.value(), 1)) * self.sp_pause.value()
        self.info(
            "شبیه‌سازی (هیچ پیامکی ارسال نمی‌شود)\n\n" + "\n".join(rows) +
            f"\n\nجمع کل: {len(self.rep.valid)} پیام، حدود {total_secs / 3600:.1f} ساعت ارسال پیوسته\n"
            f"با سقف روزانهٔ {self.sp_cap.value()} → "
            f"{max(1, -(-len(self.rep.valid) // max(self.sp_cap.value(), 1)))} روز کاری",
            "شبیه‌سازی"
        )

    # ------------------------------------------------------------------ راهنما
    def show_rules(self):
        html = f"""
        <h2>قوانین CSV — نسخهٔ {rules.RULES_VERSION}</h2>
        <p>فایل باید یک ردیف سرستون داشته باشد. ستون‌ها با نام شناسایی می‌شوند (حساس به فاصله و خط تیره نیستند).</p>
        <h3>۱) ستون شماره — اجباری</h3>
        <p>هر یک از این نام‌ها کافی است:<br><code>{'</code>، <code>'.join(rules.NUMBER_HEADERS)}</code></p>
        <p>قالب‌های پذیرفته‌شدهٔ شماره:
        ۰۹۱۲۱۲۳۴۵۶۷ (فارسی)، 09121234567، 0912 123 4567، +989121234567، 00989121234567،
        989121234567. همه به شکل استاندارد <b>09XXXXXXXXX</b> تبدیل می‌شوند.</p>
        <h3>۲) ستون نام — اختیاری</h3>
        <p>هر یک از این نام‌ها:<br><code>{'</code>، <code>'.join(rules.NAME_HEADERS)}</code><br>
        یا جدا: <code>{'</code>، <code>'.join(rules.FIRST_HEADERS)}</code> و
        <code>{'</code>، <code>'.join(rules.LAST_HEADERS)}</code></p>
        <h3>۳) ستون‌های کنترلی — اختیاری</h3>
        <ul>
        <li><code>skip</code> / <code>رد</code>: مقدار بله/1 → ردیف ارسال نمی‌شود.</li>
        <li><code>delay_ms</code>: تأخیر مخصوص همان ردیف (میلی‌ثانیه).</li>
        <li><code>group</code> / <code>گروه</code>: برچسب گروه؛ با {{group}} در متن قابل استفاده است.</li>
        <li><code>provider</code> / <code>اپراتور</code>: اپراتور اعلامی؛ در حالت سخت‌گیرانه با پیش‌شماره مقایسه می‌شود.</li>
        <li>هر ستون دیگری هم با نامش به‌صورت <code>{{نامستون}}</code> در متن پیام قابل استفاده است.</li>
        </ul>
        <h3>۴) شماره‌های ردشده</h3>
        <p>شماره‌های غیرایرانی، کوتاه، تکراری، شماره‌های نمونهٔ رایج
        (<code>09123456789</code>، <code>09111111111</code>…)، پیش‌شمارهٔ سیم‌کارت مودم
        (<code>0941</code>) و اعداد همه‌یکسان رد یا کنار گذاشته می‌شوند و گزارش آن‌ها ذخیره می‌شود.</p>
        <h3>۵) انکودینگ و اکسل</h3>
        <p>UTF-8، UTF-8 با BOM، UTF-16 و windows-1256 (اکسل فارسی) هر چهار خوانده می‌شوند.
        جداکنندهٔ , ; tab | به‌صورت خودکار تشخیص داده می‌شود.</p>
        <h3>نمونهٔ فایل</h3>
        <pre>name,number,group,delay_ms
علی رضایی,09121234567,مشتری,5000
مریم حسینی,+989351234568,همکار,
سارا محمدی,۰۹۱۹۱۲۳۴۵۶۷,,
</pre>
        """
        self.show_html("قوانین CSV و ستون‌ها", html)

    def show_limits(self):
        self.show_html("محدودیت‌های قانونی و سقف پیامک", "<pre style='white-space:pre-wrap;font-size:12px'>"
                       + LIMITS_TEXT.replace("<", "&lt;") + "</pre>")

    def show_html(self, title: str, html: str):
        if HEADLESS:
            self.log(f"[headless] راهنما: {title}")
            return
        d = QDialog(self)
        d.setWindowTitle(title)
        d.resize(760, 620)
        v = QVBoxLayout(d)
        tb = QTextBrowser()
        tb.setHtml(html)
        tb.setLayoutDirection(Qt.RightToLeft)
        v.addWidget(tb)
        b = QPushButton("بستن")
        b.clicked.connect(d.accept)
        v.addWidget(b)
        d.exec()

    # ---------------------------------------------------------------- بستن
    def closeEvent(self, event):
        try:
            self.save_settings()
        except Exception:
            pass
        if self.tray:
            self.tray.hide()
        event.accept()


def main(argv=None) -> int:
    argv = argv if argv is not None else sys.argv
    QApplication.setLayoutDirection(Qt.RightToLeft)
    app = QApplication(argv)
    app.setApplicationName(APP_NAME)
    # فونت فارسی: اگر Vazirmatn نصب باشد استفاده می‌شود، وگرنه Tahoma/Segoe UI
    for fam in ("Vazirmatn", "IRANSans", "Tahoma", "Segoe UI"):
        f = QFont(fam, 10)
        app.setFont(f)
    icon_path = resource_path(os.path.join("payamresan", "icon.png"))
    if os.path.exists(icon_path):
        app.setWindowIcon(QIcon(icon_path))
    win = MainWindow()
    win.show()
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())

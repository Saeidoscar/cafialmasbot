// ─────────────────────────────────────────────────────────────
// src/lib/i18n.js — English / Persian strings for the popup
// ─────────────────────────────────────────────────────────────
(() => {
  const CE = (globalThis.CE = globalThis.CE || {});
  if (CE.i18n) return;

  const en = {
    title: 'Contact Exporter',
    subtitle: 'Telegram · WhatsApp · Rubika · Eitaa',
    scan: 'Scan contacts',
    teach: 'Teach me',
    diagnose: 'Diagnose',
    scanning: 'Scanning…',
    hint: 'Before scanning',
    noSiteTitle: 'Open one of these web apps',
    noSiteBody: 'Log in, open the contacts or chat list, then click the extension icon again.',
    open: 'Open',
    unsupported: 'This tab is not a supported web app.',
    exportTitle: 'Export',
    scopeAll: 'All apps (merged & de-duplicated)',
    scopeSite: 'This app only',
    exportBtn: 'Download',
    copyBtn: 'Copy CSV',
    copied: 'Copied ✓',
    formatCsv: 'CSV — Excel / Sheets',
    formatVcf: 'vCard .vcf — iPhone / Android',
    formatGcsv: 'Google Contacts CSV',
    formatJson: 'JSON — backup',
    formatTxt: 'Plain text',
    search: 'Search name or number…',
    empty: 'No contacts stored yet. Open a web app and hit “Scan contacts”.',
    emptySearch: 'Nothing matches that search.',
    settings: 'Settings',
    countryCode: 'Default country code',
    countryCodeHelp: 'Turns 0912 345 6789 into +989123456789',
    maxRows: 'Row limit per scan',
    maxSeconds: 'Time limit per scan (seconds)',
    requirePhone: 'Keep only rows that contain a phone number',
    includeRaw: 'Include the raw row text in exports',
    language: 'Language',
    stored: 'Stored data',
    clearSite: 'Clear this app',
    clearAll: 'Clear everything',
    confirmClear: 'Delete the stored contacts? This cannot be undone.',
    lastScan: 'Last scan',
    never: 'never',
    diagTitle: 'Selectors found on this page — click one to scan with it',
    diagEmpty: 'No repeated list rows found on this page.',
    diagApplying: 'Scanning with the chosen selector…',
    teachResult: 'Learned selector',
    scanDone: 'Done — {n} contacts',
    scanFailed: 'Scan failed',
    errNoRows:
      'No contact rows matched. Open the contacts (or chat) panel, scroll once, then try again — or use “Teach me”.',
    errBusy: 'A scan is already running on this tab.',
    errCancelled: 'Selection cancelled.',
    progress: '{n} found · {t}',
    privacy: '100% local — nothing ever leaves your browser',
    cancelled: 'Selection cancelled',
    contactsAll: '{n} contacts · {m} apps',
    contactsOne: '{n} contacts',
    noPhone: 'no number',
    remove: 'Remove',
    tagline: 'One click. CSV, vCard, Google Contacts.',
    helpTitle: 'How it works',
    helpBody:
      'The exporter reads the contact rows that the web app has already rendered in your logged-in browser. It scrolls the list to load everything, then saves the result locally. No passwords, no servers, no API keys.',
  };

  const fa = {
    title: 'خروجی مخاطبین',
    subtitle: 'تلگرام · واتس‌اپ · روبیکا · ایتا',
    scan: 'اسکن مخاطبین',
    teach: 'آموزش',
    diagnose: 'عیب‌یابی',
    scanning: 'در حال اسکن…',
    hint: 'قبل از اسکن',
    noSiteTitle: 'یکی از این وب‌اپ‌ها را باز کنید',
    noSiteBody: 'وارد شوید، لیست مخاطبین یا چت‌ها را باز کنید و دوباره روی آیکن افزونه بزنید.',
    open: 'باز کردن',
    unsupported: 'این تب یکی از وب‌اپ‌های پشتیبانی‌شده نیست.',
    exportTitle: 'خروجی',
    scopeAll: 'همه اپ‌ها (ادغام و حذف تکراری)',
    scopeSite: 'فقط همین اپ',
    exportBtn: 'دانلود',
    copyBtn: 'کپی CSV',
    copied: 'کپی شد ✓',
    formatCsv: 'CSV — اکسل / گوگل‌شیت',
    formatVcf: 'vCard ‎.vcf — آیفون / اندروید',
    formatGcsv: 'CSV مخاطبین گوگل',
    formatJson: 'JSON — پشتیبان',
    formatTxt: 'متن ساده',
    search: 'جست‌وجوی نام یا شماره…',
    empty: 'هنوز مخاطبی ذخیره نشده. یک وب‌اپ را باز کنید و «اسکن مخاطبین» را بزنید.',
    emptySearch: 'چیزی با این جست‌وجو پیدا نشد.',
    settings: 'تنظیمات',
    countryCode: 'کد کشور پیش‌فرض',
    countryCodeHelp: '‎0912 345 6789 را به ‎+989123456789 تبدیل می‌کند',
    maxRows: 'سقف تعداد در هر اسکن',
    maxSeconds: 'محدودیت زمان هر اسکن (ثانیه)',
    requirePhone: 'فقط ردیف‌هایی که شماره دارند',
    includeRaw: 'متن خام ردیف در خروجی باشد',
    language: 'زبان',
    stored: 'داده‌های ذخیره‌شده',
    clearSite: 'پاک کردن این اپ',
    clearAll: 'پاک کردن همه',
    confirmClear: 'مخاطبین ذخیره‌شده پاک شوند؟ این کار برگشت‌پذیر نیست.',
    lastScan: 'آخرین اسکن',
    never: 'هرگز',
    diagTitle: 'سلکتورهای پیدا‌شده در این صفحه — روی یکی بزنید تا با آن اسکن شود',
    diagEmpty: 'هیچ ردیف تکرارشونده‌ای در این صفحه پیدا نشد.',
    diagApplying: 'در حال اسکن با سلکتور انتخابی…',
    teachResult: 'سلکتور یاد‌گرفته‌شده',
    scanDone: 'تمام شد — {n} مخاطب',
    scanFailed: 'اسکن نشد',
    errNoRows:
      'هیچ ردیف مخاطبی پیدا نشد. پنل مخاطبین (یا چت‌ها) را باز کنید، یک‌بار اسکرول کنید و دوباره امتحان کنید — یا از «آموزش» استفاده کنید.',
    errBusy: 'یک اسکن روی همین تب در حال اجراست.',
    errCancelled: 'انتخاب لغو شد.',
    progress: '{n} پیدا شد · {t}',
    privacy: 'کاملاً محلی — هیچ داده‌ای از مرورگر خارج نمی‌شود',
    cancelled: 'انتخاب لغو شد',
    contactsAll: '{n} مخاطب · {m} اپ',
    contactsOne: '{n} مخاطب',
    noPhone: 'بدون شماره',
    remove: 'حذف',
    tagline: 'یک کلیک. CSV، vCard، مخاطبین گوگل.',
    helpTitle: 'چطور کار می‌کند',
    helpBody:
      'افزونه همان ردیف‌های مخاطبینی را می‌خواند که وب‌اپ در مرورگر واردشده‌ی شما نمایش داده است. لیست را اسکرول می‌کند تا همه بارگذاری شود و نتیجه را محلی ذخیره می‌کند. بدون رمز، بدون سرور، بدون کلید API.',
  };

  const dict = { en, fa };
  const isRtl = (lang) => lang === 'fa';

  function t(lang, key, vars = {}) {
    const table = dict[lang] || dict.en;
    let text = table[key] ?? dict.en[key] ?? key;
    for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{${k}}`, String(v));
    return text;
  }

  function apply(lang, root = document) {
    const dir = isRtl(lang) ? 'rtl' : 'ltr';
    if (root.documentElement) {
      root.documentElement.lang = lang;
      root.documentElement.dir = dir;
    }
    root.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(lang, el.getAttribute('data-i18n'));
    });
    root.querySelectorAll('[data-i18n-ph]').forEach((el) => {
      el.setAttribute('placeholder', t(lang, el.getAttribute('data-i18n-ph')));
    });
    root.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.setAttribute('title', t(lang, el.getAttribute('data-i18n-title')));
    });
  }

  CE.i18n = { dict, t, apply, isRtl, languages: ['en', 'fa'] };
})();

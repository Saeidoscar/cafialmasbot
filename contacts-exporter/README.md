# Contact Exporter — Telegram · WhatsApp · Rubika · Eitaa

A Chrome/Edge/Brave extension that exports your contacts from the **Telegram, WhatsApp, Rubika and Eitaa web apps** into files you can actually import somewhere else:

| Format | File | Use it for |
|---|---|---|
| **CSV** | `contacts-…-N.csv` | Excel, Google Sheets, Numbers |
| **vCard 3.0** | `contacts-…-N.vcf` | iPhone / Android / macOS Contacts, Outlook |
| **Google CSV** | `contacts-…-N.csv` | contacts.google.com → *Import* |
| **JSON** | `contacts-…-N.json` | backup, scripts, your own tooling |
| **Plain text** | `contacts-…-N.txt` | quick copy/paste |

Everything runs **locally in your browser**. No server, no account, no password, no API key, no telemetry — the extension never sends a single byte outside your machine.

```
┌──────────────────────────────────────────────────────────────┐
│  you are already logged in to the web app                    │
│  ┌────────────────────┐        ┌──────────────────────────┐  │
│  │ web.telegram.org   │        │  popup                   │  │
│  │ web.whatsapp.com   │◄──────►│  Scan / Teach / Diagnose │  │
│  │ web.rubika.ir      │  DOM   │  CSV · vCF · Google · JSON│ │
│  │ web.eitaa.com      │  only  └───────────┬──────────────┘  │
│  └────────────────────┘                    │                 │
│                                  chrome.storage.local (yours) │
└──────────────────────────────────────────────────────────────┘
```

---

## 1. Install (60 seconds)

1. Download / clone this repository.
2. Open `chrome://extensions` (Edge: `edge://extensions`, Brave: `brave://extensions`).
3. Turn on **Developer mode** (top-right).
4. Click **Load unpacked** and select the **`contacts-exporter/`** folder — the one containing `manifest.json`.

The icon appears in the toolbar. Pin it for one-click access.

> **Firefox:** MV3 support for `background.service_worker` is limited. Change `manifest.json` to
> `"background": { "scripts": ["background.js"] }` and load it via `about:debugging → This Firefox → Load Temporary Add-on`.

---

## 2. Export in three steps

1. **Open the web app and log in** (you already are, presumably).
2. **Open the contacts (or chat) panel** — see the per-app table below.
3. **Click the extension icon → “Scan contacts”.**

The extension scrolls the list itself, harvests every row it sees, and shows the count live. Then pick a format and hit **Download**.

### What to open before scanning

| App | Open this first | Notes |
|---|---|---|
| **Telegram** | ☰ → **Contacts** (or the chat list) | Names, @usernames, and phone numbers *only where Telegram renders them* (contact profiles). |
| **WhatsApp** | **New chat** pencil → **Contacts** tab | WhatsApp Web only knows numbers that **have a WhatsApp account** — it has no access to your phone's address book. |
| **Rubika** | Chats or Contacts panel | Names + @usernames; numbers only if the contact shared them. |
| **Eitaa** | Chats or Contacts panel | Same as Rubika. |

**Quick tip:** scroll the list once before scanning, so the app has rendered its rows. If the popup keeps finding `0`, use **Teach me** (see §4).

---

## 3. Formats, scopes and merging

- **Scope:** *All apps (merged & de-duplicated)* or a single app.
- **Merging:** contacts are matched across apps by normalised phone number, then by name. The same person found in Telegram and WhatsApp becomes **one** row whose vCard carries both numbers, and `sites: ["telegram","whatsapp"]` in JSON.
- **De-duplication** works inside a scan too, which matters because virtualised lists recycle DOM nodes while scrolling.
- **Country code** (settings): `0912 345 6789` → `+989123456789` when you set `98`. Without it, numbers are kept as-is.

CSV columns: `Name, Phone 1..3, Username, Apps, Notes, Exported at` (UTF-8 with BOM, so Excel shows Persian/Arabic correctly).

---

## 4. When a web app changes its layout

These four apps ship new markup constantly, so the scanner has three layers:

| Button | What it does |
|---|---|
| **Scan contacts** | Tries the built-in selector hints for the site, then scrolls and harvests. |
| **Teach me** | You click **one** contact row in the page. The extension derives the repeating selector, remembers it per hostname, and immediately scans. Works even after a total redesign. |
| **Diagnose** | Lists the repeating row-like selectors it can see on the page, with match counts and a text sample. Click one to scan with it. |

Learnings are stored per hostname in `chrome.storage.local`, so “Teach me” is usually a one-time step per app.

**Keyboard:** while the picker is active, `Esc` cancels.

---

## 5. Settings

| Setting | Default | Meaning |
|---|---|---|
| Default country code | empty | Prefix applied to numbers that start with `0` |
| Row limit per scan | 5000 | Safety stop |
| Time limit per scan | 240 s | Safety stop (the scan resumes from the top next time) |
| Only keep rows with a phone number | off | Skips pure @username rows |
| Include raw row text in exports | on | Puts the original row text in the `Notes`/notes field |

**Clear this app** / **Clear everything** delete the stored contacts immediately.

---

## 6. Privacy & security

Designed to hold the same line as the rest of this repository (see [`../SECURITY.md`](../SECURITY.md)):

- **No credentials.** The extension never reads passwords, session tokens or the apps' internal APIs. It only reads the DOM you can already see.
- **No network calls.** There is no `fetch`, no `XMLHttpRequest`, no external host in the manifest beyond the four web apps themselves.
- **Local storage only.** Results live in `chrome.storage.local` (your browser profile). Uninstalling the extension removes them.
- **Files stay on your machine.** Exports are generated in the popup and downloaded with a `blob:` URL.
- **Least privilege.** Permissions are `storage`, `activeTab`, `scripting` plus host permissions for the four apps only.

⚠️ **The exported files contain personal data** (names, phone numbers). Treat a `.vcf`/`.csv` export like a document full of phone numbers: don't leave it in a shared folder or send it over an untrusted channel.

### Legal note

Export only **your own** contact list. In the EU (GDPR) and Iran, copying other people's contact data into a new system can require a legal basis or their consent. The tool gives you your data; using it well is up to you.

---

## 7. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `0` contacts, red “no rows matched” | The contacts panel isn't open, or the list is empty. Open Contacts → scroll once → **Teach me** if it still fails. |
| Works on 3 apps, fails on one | That app changed its markup: **Diagnose** → click the candidate with a sensible sample. |
| Numbers missing for many rows | Normal: these apps don't publish phone numbers; they're only rendered if the contact shared them. |
| Scan stops early | Raise the time/row limit in settings; large lists (2000+) need a couple of minutes. |
| Excel shows `???` | The CSV has a UTF-8 BOM; import with "UTF-8" encoding if your Excel version still struggles. |
| Contacts look duplicated | Names differ per app and the number is hidden — dedupe relies on the phone number first, name second. |
| Popup closes mid-scan | Expected: the scan keeps running in the page (watch the floating counter). Reopen the popup to see results. |

### Getting *every* Telegram contact

Telegram's web client intentionally hides most phone numbers. If you need the complete official list, use **Telegram Desktop → Settings → Advanced → Export Telegram data → Contacts** (HTML/JSON). Use this extension for WhatsApp / Rubika / Eitaa and to merge everything else; the JSON export here is plain and easy to combine.

---

## 8. Development

```bash
cd contacts-exporter

npm test                    # unit tests for parsing + exporters (no dependencies)
npm run preview             # http://localhost:4173/preview/ — the popup against mock data

npm i --no-save jsdom       # only for the DOM smoke harness
node dev/dom-smoke.mjs      # scans a virtualised 40-row list, boots the popup end-to-end
```

### File map

```
contacts-exporter/
├── manifest.json            MV3 manifest (permissions, hosts, content scripts)
├── background.js            service worker: defaults + toolbar badge
├── src/
│   ├── lib/
│   │   ├── util.js          digits, keys, throttle, formatting
│   │   ├── extract.js       row → {name, phones, username}; de-dupe; merge   (pure)
│   │   ├── adapters.js      per-site selector hints + hints text
│   │   ├── exporters.js     CSV / vCard / Google CSV / JSON / TXT            (pure)
│   │   ├── i18n.js          English + Persian strings
│   │   └── store.js         chrome.storage wrapper (settings/results/learned/live)
│   ├── content/
│   │   ├── engine.js        scroll + harvest loop, selector picker, diagnostics
│   │   └── content.js       message bridge + in-page progress HUD
│   └── ui/                  popup.html / popup.css / popup.js
├── dev/
│   ├── mock-chrome.js       chrome.* stub so the popup runs as a web page
│   └── dom-smoke.mjs        jsdom harness
├── preview/index.html       interactive preview page
├── icons/                   generated PNGs (16/32/48/128) + source SVG
├── test/                    node:test suites
└── tools/serve.js           zero-dependency static server for the preview
```

### How the scanner works

1. **Find rows** — explicit selector → learned selector → adapter hints.
2. **Find the scroll container** — climb from a row to the nearest scrollable ancestor (works on all four apps, no hard-coded layout).
3. **Scroll from the top in ~85 %-viewport steps**, waiting for mutations after each step, harvesting rows as they appear and de-duplicating by key. Stepping (instead of jumping to the end) is what makes virtualised lists complete.
4. **Restore** the original scroll position when done.

All parsing is text-based (the row's `innerText`), so nothing depends on React props or internal APIs.

---

## 9. راهنمای سریع فارسی

۱. پوشه `contacts-exporter` را در `chrome://extensions` با گزینه **Load unpacked** نصب کنید (Developer mode باید روشن باشد).
۲. وارد وب‌اپ شوید و **پنل مخاطبین یا چت‌ها** را باز کنید.
۳. روی آیکن افزونه بزنید و **«اسکن مخاطبین»** را انتخاب کنید.
۴. یکی از خروجی‌ها را بگیرید: **CSV** (اکسل)، **vCard** (آیفون/اندروید)، **CSV گوگل** یا **JSON**.

- اگر مخاطبی پیدا نشد: یک‌بار لیست را اسکرول کنید، یا **«آموزش»** را بزنید و روی یک ردیف مخاطب کلیک کنید.
- شماره‌ها فقط وقتی استخراج می‌شوند که خودِ اپ آن‌ها را نمایش دهد (تلگرام و روبیکا معمولاً پنهان می‌کنند).
- همه‌چیز محلی است: نه سرور، نه رمز، نه کلید API. داده‌ها فقط در مرورگر خودتان ذخیره می‌شوند.

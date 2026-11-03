// ─────────────────────────────────────────────────────────────
// src/lib/extract.js — pure parsing / normalisation logic
//
// Everything in this file is DOM-in, plain-object-out so it can be
// unit-tested with `node --test` without a browser.
// ─────────────────────────────────────────────────────────────
(() => {
  const CE = (globalThis.CE = globalThis.CE || {});
  if (CE.extract) return;
  const U = CE.util;

  // Lines that are never a contact name — UI chrome, presence, previews.
  const IGNORE_LINE = [
    /^(online|offline|last seen.*|typing…?|typing\.\.\.|click here for contact info|hey there!? i am using whatsapp\.?|you|message|photo|video|sticker|voice message|gif|document|contact|location|poll|missed call|joined telegram|deleted message)$/i,
    /^(آنلاین|آفلاین|آخرین بازدید.*|در حال نوشتن.*|در حال تایپ.*|شما|پیام|عکس|ویدیو|استیکر|پیام صوتی|سند|موقعیت مکانی|تماس بی‌پاسخ|به تلگرام پیوست|پیام حذف شد)$/i,
    /^\d{1,2}:\d{2}(\s?[ap]\.?m\.?)?$/i,
    /^\d{1,2}\/\d{1,2}\/\d{2,4}$/,
    /^(دیروز|امروز|yesterday|today|just now|همین حالا)$/i,
    /^\d+$/, // unread badge
    /^[\s.,·•|—-]+$/,
  ];

  const PHONE_RE = /(?:\+|00)?\d(?:[\d \t().\-\/]{4,18})\d/g;
  const USERNAME_RE = /(?:^|[\s(|])@([A-Za-z][A-Za-z0-9_]{3,31})\b/;

  function looksIgnorable(line) {
    return IGNORE_LINE.some((re) => re.test(line));
  }

  /**
   * Pull every plausible phone number out of a blob of text.
   * Persian/Arabic digits are normalised first; dates and clock times skipped.
   */
  function findPhones(text) {
    if (!text) return [];
    const t = U.normalizeDigits(text);
    const out = [];
    let m;
    PHONE_RE.lastIndex = 0;
    while ((m = PHONE_RE.exec(t)) !== null) {
      const raw = m[0].trim().replace(/[ \t]+/g, ' ');
      if (/\d\s*:\s*\d/.test(raw)) continue; // 12:30
      if (/\d{1,4}\s*[-/]\s*\d{1,2}\s*[-/]\s*\d{1,4}/.test(raw)) continue; // dates
      const digits = raw.replace(/\D/g, '');
      if (digits.length < 7 || digits.length > 15) continue;
      out.push(raw);
      if (out.length >= 6) break;
    }
    return [...new Set(out)];
  }

  /**
   * Normalise a phone number to a compact form.
   * 0912 345 6789 + defaultCountry "98" → +989123456789
   * +49 (176) 123-4567                → +491761234567
   */
  function normalizePhone(raw, defaultCountry = '') {
    if (raw == null) return '';
    let s = U.normalizeDigits(String(raw)).trim();
    if (!s) return '';
    const hadPlus = s.startsWith('+');
    let digits = s.replace(/\D/g, '');
    if (!digits) return '';

    if (!hadPlus && digits.startsWith('00')) digits = digits.slice(2);
    const cc = String(defaultCountry || '').replace(/\D/g, '');

    if (hadPlus || s.startsWith('00')) return `+${digits}`;
    if (digits.startsWith('0') && cc) {
      return `+${cc}${digits.replace(/^0+/, '')}`;
    }
    if (cc && digits.length <= 10 && !digits.startsWith(cc)) {
      return `+${cc}${digits}`;
    }
    return digits;
  }

  /** Best-effort display name from the lines of a list row. */
  function pickName(lines) {
    for (const line of lines) {
      const text = U.squash(line);
      if (!text || text.length > 80) continue;
      if (looksIgnorable(text)) continue;
      if (findPhones(text).join('') === text && !/\p{L}/u.test(text)) continue; // pure phone
      if (USERNAME_RE.test(text) && !/\p{L}/u.test(text.replace(USERNAME_RE, ''))) {
        // "@someone" alone is not a name; keep looking
        continue;
      }
      return text;
    }
    return '';
  }

  function dedupeKey(rec, settings = {}) {
    const phone = (rec.phones && rec.phones[0]) || '';
    const norm = normalizePhone(phone, settings.countryCode || '');
    if (norm) return `p:${norm}`;
    const nk = U.nameKey(rec.name);
    return nk ? `n:${nk}|${rec.site || ''}` : '';
  }

  /**
   * Turn one contact row element into a record.
   * @param {Element} el
   * @param {object} adapter  site adapter (optional)
   * @param {object} opts     { site, settings }
   */
  function parseRow(el, adapter = {}, opts = {}) {
    if (!el) return null;
    let text = '';
    try {
      text = (el.innerText || el.textContent || '').trim();
    } catch {
      return null;
    }
    if (!text) return null;

    const lines = text
      .split('\n')
      .map((l) => l.replace(/\u00a0/g, ' ').trim())
      .filter(Boolean);

    // ── name ────────────────────────────────────────────────
    let name = '';
    if (adapter.nameSelector) {
      try {
        const node = el.querySelector(adapter.nameSelector);
        if (node) name = pickName([(node.innerText || node.textContent || '').trim()]);
      } catch {
        name = '';
      }
    }
    if (!name) name = pickName(lines);

    // ── phones ──────────────────────────────────────────────
    let phones = [];
    if (adapter.phoneSelector) {
      try {
        el.querySelectorAll(adapter.phoneSelector).forEach((node) => {
          phones.push(...findPhones(node.innerText || node.textContent || ''));
        });
      } catch {
        phones = [];
      }
    }
    phones.push(...findPhones(text));
    phones = [...new Set(phones)].slice(0, 3);

    // ── username / handle ───────────────────────────────────
    let username = '';
    if (adapter.usernameSelector) {
      try {
        const node = el.querySelector(adapter.usernameSelector);
        if (node) {
          const m = (node.innerText || '').match(USERNAME_RE);
          username = m ? m[1] : (node.innerText || '').trim().replace(/^@/, '');
        }
      } catch {
        username = '';
      }
    }
    if (!username) {
      const m = text.match(USERNAME_RE);
      if (m) username = m[1];
    }

    if (!name && !phones.length && !username) return null;

    const rec = {
      name: name || (phones[0] ? '' : username),
      phones,
      username,
      site: opts.site || adapter.id || '',
      source: adapter.label || opts.site || '',
      raw: U.squash(text).slice(0, 180),
      at: Date.now(),
    };
    rec.key = dedupeKey(rec, opts.settings);
    if (!rec.key) return null;
    return rec;
  }

  /** Merge duplicate records (same phone or same name inside one site). */
  function mergeRecords(records, settings = {}) {
    const cc = settings.countryCode || '';
    const addPhone = (target, phone) => {
      const norm = normalizePhone(phone, cc) || phone;
      if (!target.phones.some((p) => (normalizePhone(p, cc) || p) === norm)) target.phones.push(phone);
    };
    const map = new Map();
    const orphans = [];
    for (const rec of records) {
      if (!rec) continue;
      const key = dedupeKey(rec, settings) || rec.key;
      if (!key) continue;
      const prev = map.get(key);
      if (!prev) {
        map.set(key, {
          name: rec.name || '',
          phones: [...(rec.phones || [])],
          username: rec.username || '',
          site: rec.site || '',
          source: rec.source || rec.site || '',
          raw: rec.raw || '',
          at: rec.at || Date.now(),
          key,
        });
        continue;
      }
      if (!prev.name && rec.name) prev.name = rec.name;
      else if (rec.name && rec.name.length > prev.name.length && !findPhones(rec.name).length) {
        prev.name = rec.name;
      }
      if (!prev.username && rec.username) prev.username = rec.username;
      for (const p of rec.phones || []) addPhone(prev, p);
      if (!prev.raw && rec.raw) prev.raw = rec.raw;
    }
    return [...map.values(), ...orphans];
  }

  /**
   * Merge contacts coming from several sites into one address book.
   * Same normalised phone ⇒ one person; identical names also collapse.
   * Each merged record keeps every source it was seen in.
   */
  function mergeAcrossSites(contacts, settings = {}) {
    const cc = settings.countryCode || '';
    const records = [];
    const byPhone = new Map();
    const byName = new Map();

    for (const c of contacts) {
      if (!c) continue;
      const phones = [...new Set(c.phones || [])];
      if (!c.name && !phones.length && !c.username) continue;

      const phoneKeys = phones.map((p) => normalizePhone(p, cc)).filter(Boolean);
      const nameKey = U.nameKey(c.name);
      let target =
        phoneKeys.map((k) => byPhone.get(k)).find(Boolean) ||
        (nameKey ? byName.get(nameKey) : undefined) ||
        null;

      if (!target) {
        target = {
          name: c.name || '',
          phones: [],
          username: c.username || '',
          sites: new Set(),
          names: new Set(),
          raw: c.raw || '',
          at: c.at || Date.now(),
        };
        records.push(target);
      }

      if (!target.name && c.name) target.name = c.name;
      else if (c.name && c.name.length > target.name.length && !findPhones(c.name).length) {
        target.name = c.name;
      }
      if (!target.username && c.username) target.username = c.username;
      if (c.name) target.names.add(c.name);
      phones.forEach((p) => {
        const norm = normalizePhone(p, cc) || p;
        if (!target.phones.some((q) => (normalizePhone(q, cc) || q) === norm)) target.phones.push(p);
      });
      (c.sites || (c.site ? [c.site] : [])).forEach((s) => target.sites.add(s));
      if (!target.raw && c.raw) target.raw = c.raw;
      if (c.at && c.at < target.at) target.at = c.at;

      phoneKeys.forEach((k) => byPhone.set(k, target));
      if (nameKey) byName.set(nameKey, target);
    }

    return records.map((c) => ({
      name: c.name,
      phones: c.phones,
      username: c.username,
      sites: [...c.sites],
      names: [...c.names],
      raw: c.raw,
      at: c.at,
    }));
  }

  /** Split a display name into given/family for vCard + Google CSV. */
  function splitName(fullName) {
    const clean = U.squash(fullName || '');
    if (!clean || !/\p{L}/u.test(clean)) return { given: '', family: '' };
    const parts = clean.split(' ');
    if (parts.length === 1) return { given: parts[0], family: '' };
    return { given: parts[0], family: parts.slice(1).join(' ') };
  }

  function sortContacts(list) {
    return [...list].sort((a, b) => {
      const an = a.name || a.phones?.[0] || '';
      const bn = b.name || b.phones?.[0] || '';
      return an.localeCompare(bn, ['fa', 'en'], { sensitivity: 'base', numeric: true });
    });
  }

  CE.extract = {
    PHONE_RE,
    USERNAME_RE,
    looksIgnorable,
    findPhones,
    normalizePhone,
    pickName,
    dedupeKey,
    parseRow,
    mergeRecords,
    mergeAcrossSites,
    splitName,
    sortContacts,
  };
})();

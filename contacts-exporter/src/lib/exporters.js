// ─────────────────────────────────────────────────────────────
// src/lib/exporters.js — CSV / vCard / Google Contacts / JSON
//
// Pure string builders (unit-tested) + one small download helper.
// ─────────────────────────────────────────────────────────────
(() => {
  const CE = (globalThis.CE = globalThis.CE || {});
  if (CE.exporters) return;
  const U = CE.util;

  const FORMATS = {
    csv: { ext: 'csv', mime: 'text/csv;charset=utf-8' },
    vcf: { ext: 'vcf', mime: 'text/vcard;charset=utf-8' },
    gcsv: { ext: 'csv', mime: 'text/csv;charset=utf-8' },
    json: { ext: 'json', mime: 'application/json;charset=utf-8' },
    txt: { ext: 'txt', mime: 'text/plain;charset=utf-8' },
  };

  /** RFC-4180 style field escaping. */
  function csvCell(value) {
    const s = value == null ? '' : String(value);
    if (/[",\r\n]/.test(s) || /^\s|\s$/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function csvRow(cells) {
    return cells.map(csvCell).join(',');
  }

  const displayPhone = (phone, settings) =>
    CE.extract.normalizePhone(phone, settings?.countryCode || '') || phone || '';

  const appNames = (c, lang) => {
    const sites = c.sites || (c.site ? [c.site] : []);
    return sites
      .map((id) => (lang === 'fa' ? CE.adapters.sites[id]?.labelFa : CE.adapters.sites[id]?.label) || id)
      .join(' / ');
  };

  /** Generic spreadsheet export (Excel / Numbers / LibreOffice friendly, BOM included). */
  function toCSV(contacts, settings = {}) {
    const header = ['Name', 'Phone 1', 'Phone 2', 'Phone 3', 'Username', 'Apps', 'Notes', 'Exported at'];
    const at = U.nowIso();
    const rows = contacts.map((c) => {
      const phones = (c.phones || []).map((p) => displayPhone(p, settings));
      return csvRow([
        c.name || '',
        phones[0] || '',
        phones[1] || '',
        phones[2] || '',
        c.username ? `@${c.username.replace(/^@/, '')}` : '',
        appNames(c, 'en'),
        settings.includeRaw === false ? '' : c.raw || '',
        at,
      ]);
    });
    return `\uFEFF${[csvRow(header), ...rows].join('\r\n')}\r\n`;
  }

  /** vCard 3.0 — imports into iOS, Android, Google Contacts, Outlook. */
  function vCardEscape(value) {
    return String(value == null ? '' : value)
      .replace(/\\/g, '\\\\')
      .replace(/\r?\n/g, '\\n')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,');
  }

  function toVCard(contacts, settings = {}) {
    const lines = [];
    for (const c of contacts) {
      const { given, family } = CE.extract.splitName(c.name);
      const phones = (c.phones || []).map((p) => displayPhone(p, settings)).filter(Boolean);
      const sites = (c.sites || (c.site ? [c.site] : []))
        .map((id) => CE.adapters.sites[id]?.label || id)
        .join(', ');

      lines.push('BEGIN:VCARD');
      lines.push('VERSION:3.0');
      lines.push(`N:${vCardEscape(family)};${vCardEscape(given)};;;`);
      lines.push(`FN:${vCardEscape(c.name || phones[0] || c.username || '')}`);
      phones.forEach((p, i) => {
        lines.push(`TEL;TYPE=${i === 0 ? 'CELL' : 'VOICE'}:${vCardEscape(p)}`);
      });
      if (c.username) {
        const handle = c.username.replace(/^@/, '');
        const siteId = (c.sites || [])[0] || c.site || '';
        lines.push(`X-SOCIALPROFILE;TYPE=${siteId || 'messenger'}:${vCardEscape(`@${handle}`)}`);
      }
      const notes = [sites ? `Imported from ${sites}` : '', c.names && c.names.length > 1 ? `Also known as: ${c.names.join(', ')}` : '']
        .filter(Boolean)
        .join(' — ');
      if (notes) lines.push(`NOTE:${vCardEscape(notes)}`);
      lines.push('END:VCARD');
    }
    return `${lines.join('\r\n')}\r\n`;
  }

  const GOOGLE_HEADER = [
    'Name Prefix',
    'First Name',
    'Middle Name',
    'Last Name',
    'Name Suffix',
    'Nickname',
    'Given Name Yomi',
    'Additional Name Yomi',
    'Family Name Yomi',
    'Phonetic First Name',
    'Phonetic Middle Name',
    'Phonetic Last Name',
    'File As',
    'Organization Name',
    'Organization Title',
    'Organization Department',
    'Birthday',
    'Notes',
    'Photo',
    'Labels',
    'Phone 1 - Type',
    'Phone 1 - Value',
    'Phone 2 - Type',
    'Phone 2 - Value',
    'Phone 3 - Type',
    'Phone 3 - Value',
  ];

  /** CSV layout accepted by contacts.google.com → Import. */
  function toGoogleCSV(contacts, settings = {}) {
    const rows = contacts.map((c) => {
      const { given, family } = CE.extract.splitName(c.name);
      const phones = (c.phones || []).map((p) => displayPhone(p, settings)).filter(Boolean);
      const siteIds = c.sites || (c.site ? [c.site] : []);
      const labels = siteIds.map((id) => CE.adapters.sites[id]?.label || id).join(' : ');
      const notes = [
        siteIds.length ? `Imported from ${labels}` : '',
        c.username ? `Username: @${c.username.replace(/^@/, '')}` : '',
      ]
        .filter(Boolean)
        .join(' | ');
      return csvRow([
        '',
        given,
        '',
        family,
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        c.name || given || phones[0] || '',
        '',
        '',
        '',
        '',
        notes,
        '',
        labels,
        'Mobile',
        phones[0] || '',
        phones[1] ? 'Mobile' : '',
        phones[1] || '',
        phones[2] ? 'Mobile' : '',
        phones[2] || '',
      ]);
    });
    return `\uFEFF${[csvRow(GOOGLE_HEADER), ...rows].join('\r\n')}\r\n`;
  }

  function toJSON(contacts, settings = {}, meta = {}) {
    return `${JSON.stringify(
      {
        app: 'contacts-exporter',
        version: 1,
        exportedAt: U.nowIso(),
        count: contacts.length,
        settings: { countryCode: settings.countryCode || '' },
        ...meta,
        contacts: contacts.map((c) => ({
          name: c.name || '',
          phones: (c.phones || []).map((p) => displayPhone(p, settings)),
          username: c.username || '',
          sites: c.sites || (c.site ? [c.site] : []),
          names: c.names || [],
          notes: c.raw || '',
        })),
      },
      null,
      2
    )}\n`;
  }

  function toTXT(contacts, settings = {}) {
    return (
      contacts
        .map((c) => {
          const phones = (c.phones || []).map((p) => displayPhone(p, settings)).join(' | ');
          return [c.name || phones || `@${c.username || ''}`, phones, c.username ? `@${c.username}` : '']
            .filter(Boolean)
            .join(' — ');
        })
        .join('\n') + '\n'
    );
  }

  function serialize(format, contacts, settings = {}, meta = {}) {
    switch (format) {
      case 'vcf':
        return { body: toVCard(contacts, settings), ...FORMATS.vcf };
      case 'gcsv':
        return { body: toGoogleCSV(contacts, settings), ...FORMATS.gcsv };
      case 'json':
        return { body: toJSON(contacts, settings, meta), ...FORMATS.json };
      case 'txt':
        return { body: toTXT(contacts, settings), ...FORMATS.txt };
      case 'csv':
      default:
        return { body: toCSV(contacts, settings), ...FORMATS.csv };
    }
  }

  function stamp(date = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
  }

  function filename(format, scope, count) {
    const ext = FORMATS[format]?.ext || 'csv';
    return `contacts-${scope}-${stamp()}-${count}.${ext}`;
  }

  /** Browser download via a temporary blob URL (no network, no permissions). */
  function download(body, name, mime) {
    if (typeof document === 'undefined') return;
    const blob = new Blob([body], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  CE.exporters = {
    FORMATS,
    csvCell,
    toCSV,
    toVCard,
    toGoogleCSV,
    toJSON,
    toTXT,
    serialize,
    filename,
    download,
  };
})();

import test from 'node:test';
import assert from 'node:assert/strict';

import '../src/lib/util.js';
import '../src/lib/extract.js';
import '../src/lib/adapters.js';

const { CE } = globalThis;
const X = CE.extract;

/** Minimal stand-in for a DOM row element (only innerText + selectors are used). */
function row(text, extra = {}) {
  return {
    innerText: text,
    querySelector: () => null,
    querySelectorAll: () => [],
    ...extra,
  };
}

test('normalizeDigits converts Persian and Arabic-Indic numerals', () => {
  assert.equal(CE.util.normalizeDigits('۰۹۱۲۳۴۵۶۷۸۹'), '09123456789');
  assert.equal(CE.util.normalizeDigits('٠٩١٢'), '0912');
  assert.equal(CE.util.normalizeDigits('+98 912'), '+98 912');
});

test('findPhones pulls international, local and spaced numbers', () => {
  const found = X.findPhones('Sara Ahmadi +98 912 345 6789 online');
  assert.equal(found.length, 1);
  assert.match(found[0].replace(/\s/g, ''), /^\+989123456789$/);

  const local = X.findPhones('Reza 0912-555-1122');
  assert.equal(local.length, 1);

  const persian = X.findPhones('علی ۰۹۱۲۱۲۳۴۵۶۷');
  assert.equal(persian.length, 1);
  assert.match(persian[0], /09121234567/);
});

test('findPhones ignores clock times, dates and short numbers', () => {
  assert.deepEqual(X.findPhones('last seen 12:30'), []);
  assert.deepEqual(X.findPhones('12/05/2024'), []);
  assert.deepEqual(X.findPhones('call 12345'), []);
});

test('normalizePhone turns local numbers into E.164 using the country code', () => {
  assert.equal(X.normalizePhone('0912 345 6789', '98'), '+989123456789');
  assert.equal(X.normalizePhone('+49 (176) 123-4567', '98'), '+491761234567');
  assert.equal(X.normalizePhone('0049 176 1234567', ''), '+491761234567');
  assert.equal(X.normalizePhone('۰۹۱۲۱۲۳۴۵۶۷', '98'), '+989121234567');
  assert.equal(X.normalizePhone('9123456789', ''), '9123456789');
});

test('pickName skips presence lines, badges and phone-only rows', () => {
  assert.equal(X.pickName(['online', 'Sara Ahmadi']), 'Sara Ahmadi');
  assert.equal(X.pickName(['۳', 'نازنین محمدی', 'آخرین بازدید اخیراً']), 'نازنین محمدی');
  assert.equal(X.pickName(['+98 912 345 6789']), '');
  assert.equal(X.pickName(['@someone_only']), '');
});

test('parseRow builds a record with name, phone, username and a stable key', () => {
  const rec = X.parseRow(
    row('Sara Ahmadi\n+98 912 345 6789\n@sara_ahmadi\nonline'),
    { id: 'telegram' },
    { site: 'telegram', settings: { countryCode: '98' } }
  );
  assert.equal(rec.name, 'Sara Ahmadi');
  assert.deepEqual(rec.phones, ['+98 912 345 6789']);
  assert.equal(rec.username, 'sara_ahmadi');
  assert.equal(rec.site, 'telegram');
  assert.equal(rec.key, 'p:+989123456789');
});

test('parseRow returns null for rows without any usable data', () => {
  assert.equal(X.parseRow(row('online\ntyping…'), { id: 'telegram' }, { site: 'telegram' }), null);
});

test('mergeRecords collapses duplicates that differ only in formatting', () => {
  const settings = { countryCode: '98' };
  const list = [
    { name: 'Sara Ahmadi', phones: ['0912 345 6789'], site: 'telegram' },
    { name: 'Sara Ahmadi', phones: ['+98 912 345 6789'], site: 'telegram' },
    { name: 'Reza Karimi', phones: [], site: 'telegram' },
    { name: 'Reza Karimi', phones: [], site: 'telegram' },
  ];
  const merged = X.mergeRecords(list, settings);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].phones.length, 1);
});

test('mergeAcrossSites keeps one person and collects every source app', () => {
  const settings = { countryCode: '98' };
  const merged = X.mergeAcrossSites(
    [
      { name: 'Sara Ahmadi', phones: ['+98 912 345 6789'], site: 'telegram', username: 'sara_ahmadi' },
      { name: 'سارا احمدی', phones: ['09123456789'], site: 'whatsapp' },
      { name: 'Jonas Weber', phones: ['+49 176 9988 776'], site: 'whatsapp' },
      { name: 'Ali Hosseini', phones: [], site: 'rubika' },
      { name: 'Ali Hosseini', phones: [], site: 'eitaa' },
    ],
    settings
  );
  assert.equal(merged.length, 3);

  const sara = merged.find((c) => (c.sites || []).includes('telegram') && (c.sites || []).includes('whatsapp'));
  assert.ok(sara, 'Sara is merged across telegram + whatsapp');
  assert.equal(sara.phones.length, 1);

  const ali = merged.find((c) => c.name === 'Ali Hosseini');
  assert.deepEqual(ali.sites.sort(), ['eitaa', 'rubika']);
});

test('splitName handles single words, full names and phone-like labels', () => {
  assert.deepEqual(X.splitName('Sara'), { given: 'Sara', family: '' });
  assert.deepEqual(X.splitName('Sara Ahmadi'), { given: 'Sara', family: 'Ahmadi' });
  assert.deepEqual(X.splitName('نازنین محمدی'), { given: 'نازنین', family: 'محمدی' });
  assert.deepEqual(X.splitName('+98 912 345 6789'), { given: '', family: '' });
});

test('sortContacts orders names alphabetically inside each script', () => {
  assert.deepEqual(
    X.sortContacts([{ name: 'Charlie' }, { name: 'Alice' }, { name: 'Bob' }]).map((c) => c.name),
    ['Alice', 'Bob', 'Charlie']
  );
  const persian = X.sortContacts([{ name: 'پریسا' }, { name: 'الف' }, { name: 'بهنام' }]).map((c) => c.name);
  assert.deepEqual(persian, ['الف', 'بهنام', 'پریسا']);
  // contacts without a name fall back to their phone number for sorting
  const mixed = X.sortContacts([{ name: '', phones: ['+49 1'] }, { name: 'Ali' }]);
  assert.equal(mixed.length, 2);
});

test('adapters detect the supported web apps and nothing else', () => {
  assert.equal(CE.adapters.byUrl('https://web.telegram.org/k/#-1001')?.id, 'telegram');
  assert.equal(CE.adapters.byUrl('https://web.whatsapp.com/')?.id, 'whatsapp');
  assert.equal(CE.adapters.byUrl('https://web.rubika.ir/')?.id, 'rubika');
  assert.equal(CE.adapters.byUrl('https://eitaa.com/')?.id, 'eitaa');
  assert.equal(CE.adapters.byUrl('https://example.com/'), null);
  assert.equal(CE.adapters.list().length, 4);
});

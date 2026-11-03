import test from 'node:test';
import assert from 'node:assert/strict';

import '../src/lib/util.js';
import '../src/lib/extract.js';
import '../src/lib/adapters.js';
import '../src/lib/exporters.js';

const { CE } = globalThis;
const E = CE.exporters;
const settings = { countryCode: '98' };

/** Tiny RFC-4180 row parser, used only to verify column alignment. */
function parseCsvLine(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      cells.push(cell);
      cell = '';
    } else {
      cell += ch;
    }
  }
  cells.push(cell);
  return cells;
}

const sample = [
  {
    name: 'Sara Ahmadi',
    phones: ['0912 345 6789', '+49 176 1234 5678'],
    username: 'sara_ahmadi',
    sites: ['telegram', 'whatsapp'],
    names: ['Sara Ahmadi', 'سارا احمدی'],
    raw: 'Sara Ahmadi +98 912 345 6789 @sara_ahmadi',
  },
  {
    name: 'شرکت الماس، شعبه "مرکزی"',
    phones: ['021 8877 6655'],
    username: '',
    sites: ['eitaa'],
    raw: 'شرکت الماس',
  },
];

test('csvCell quotes separators, quotes and newlines', () => {
  assert.equal(E.csvCell('plain'), 'plain');
  assert.equal(E.csvCell('a,b'), '"a,b"');
  assert.equal(E.csvCell('he said "hi"'), '"he said ""hi"""');
  assert.equal(E.csvCell('line1\nline2'), '"line1\nline2"');
  assert.equal(E.csvCell(' padded '), '" padded "');
});

test('toCSV writes a BOM, a header and one row per contact', () => {
  const csv = E.toCSV(sample, settings);
  assert.ok(csv.startsWith('\uFEFF'), 'starts with a UTF-8 BOM for Excel');
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^Name,Phone 1,Phone 2/);
  assert.match(lines[1], /^Sara Ahmadi,\+989123456789,\+4917612345678,,@sara_ahmadi,Telegram \/ WhatsApp,/);
});

test('toVCard emits one valid vCard per contact with escaped fields', () => {
  const vcf = E.toVCard(sample, settings);
  assert.equal((vcf.match(/BEGIN:VCARD/g) || []).length, 2);
  assert.equal((vcf.match(/END:VCARD/g) || []).length, 2);
  assert.match(vcf, /VERSION:3\.0/);
  assert.match(vcf, /N:Ahmadi;Sara;;;/);
  assert.match(vcf, /FN:Sara Ahmadi/);
  assert.match(vcf, /TEL;TYPE=CELL:\+989123456789/);
  assert.match(vcf, /X-SOCIALPROFILE;TYPE=telegram:@sara_ahmadi/);
  assert.match(vcf, /FN:شرکت الماس، شعبه "مرکزی"/);
});

test('toGoogleCSV header and rows have the same column count', () => {
  const csv = E.toGoogleCSV(sample, settings);
  const lines = csv.trim().split('\r\n');
  const columns = lines[0].split(',').length;
  assert.equal(columns, 26);
  for (const line of lines.slice(1)) {
    assert.equal(parseCsvLine(line).length, columns, `row column mismatch: ${line}`);
  }
  assert.match(lines[1], /^,Sara,,Ahmadi,/);
});

test('toJSON round-trips the fields that matter', () => {
  const parsed = JSON.parse(E.toJSON(sample, settings, { scope: 'all' }));
  assert.equal(parsed.count, 2);
  assert.equal(parsed.scope, 'all');
  assert.equal(parsed.contacts[0].name, 'Sara Ahmadi');
  assert.deepEqual(parsed.contacts[0].phones, ['+989123456789', '+4917612345678']);
  assert.deepEqual(parsed.contacts[0].sites, ['telegram', 'whatsapp']);
});

test('serialize maps each format to the right extension + mime', () => {
  assert.equal(E.serialize('csv', sample, settings).ext, 'csv');
  assert.equal(E.serialize('vcf', sample, settings).mime, 'text/vcard;charset=utf-8');
  assert.equal(E.serialize('gcsv', sample, settings).ext, 'csv');
  assert.equal(E.serialize('json', sample, settings).ext, 'json');
  assert.equal(E.serialize('nope', sample, settings).ext, 'csv');
});

test('filename is dated, scoped and includes the row count', () => {
  const name = E.filename('vcf', 'whatsapp', 42);
  assert.match(name, /^contacts-whatsapp-\d{4}-\d{2}-\d{2}-42\.vcf$/);
});

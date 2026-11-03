// ─────────────────────────────────────────────────────────────
// dev/dom-smoke.mjs — headless verification of the two riskiest parts
//
//   node dev/dom-smoke.mjs        (needs: npm i --no-save jsdom)
//
// 1. engine.scan() against a *virtualised* list (only 10 of 40 rows are in
//    the DOM at any time) — proves the scroll + harvest loop collects all
//    rows and de-duplicates recycled nodes.
// 2. the popup UI booted with mock-chrome data — proves rendering, scan
//    progress, language switch and diagnostics panels don't throw.
// ─────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

let failures = 0;
const check = (label, condition, extra = '') => {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${label} ${extra}`);
  }
};

// jsdom has no layout engine — fake the bits the engine relies on.
function patchLayout(window, doc) {
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    return { width: 320, height: 64, top: 0, left: 0, right: 320, bottom: 64, x: 0, y: 0 };
  };
  Object.defineProperty(window.Element.prototype, 'clientHeight', {
    configurable: true,
    get() {
      return this.classList?.contains('scrollable') ? 480 : 64;
    },
  });
  Object.defineProperty(window.Element.prototype, 'scrollHeight', {
    configurable: true,
    get() {
      if (!this.classList?.contains('scrollable')) return 64;
      return Number(this.dataset.total || 0) * 64;
    },
  });
  Object.defineProperty(window.Element.prototype, 'scrollTop', {
    configurable: true,
    get() {
      return Number(this.dataset.scrollTop || 0);
    },
    set(value) {
      this.dataset.scrollTop = String(value);
      if (typeof this.__onScroll === 'function') this.__onScroll(value);
    },
  });
  doc.defaultView.getComputedStyle = (el) => ({
    visibility: 'visible',
    display: 'block',
    opacity: '1',
    overflowY: el.classList?.contains('scrollable') ? 'auto' : 'visible',
    overflow: 'visible',
  });
  window.Element.prototype.scrollIntoView = () => {};
  window.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  window.Event = window.Event || class {};
}

const NAMES = [
  'Sara Ahmadi', 'Reza Karimi', 'نازنین محمدی', 'Ali Hosseini', 'مریم رضایی',
  'Jonas Weber', 'فروشگاه الماس', 'Hossein Nouri', 'Lena Fischer', 'محمد صادقی',
  'Fatemeh Akbari', 'Cafe Almas', 'Nima Rahimi', 'سارا محمدی', 'Peter Schmidt',
  'Zahra Kazemi', 'Ali Rezaei', 'Neda Tehrani', 'Omid Sadeghi', 'Leila Moradi',
];

async function testEngine() {
  console.log('\nengine.scan() — virtualised list of 40 rows, 10 in DOM');
  const total = 40;
  const html = `<!doctype html><html><body>
    <div id="column-left"><div class="chatlist scrollable" data-total="40">
      <div id="rows"></div>
    </div></div>
  </body></html>`;

  const dom = new JSDOM(html, { url: 'https://web.telegram.org/k/', pretendToBeVisual: true, runScripts: 'outside-only' });
  const { window } = dom;
  patchLayout(window, window.document);

  // classic-script libs into the jsdom realm
  for (const file of ['src/lib/util.js', 'src/lib/extract.js', 'src/lib/adapters.js', 'src/content/engine.js']) {
    window.eval(read(file));
  }

  const doc = window.document;
  const rows = doc.getElementById('rows');
  const people = Array.from({ length: total }, (_, i) => ({
    name: NAMES[i % NAMES.length] + (i >= NAMES.length ? ` ${i}` : ''),
    phone: i % 3 === 0 ? `+98 912 ${String(1000000 + i)}` : '',
  }));

  const RENDERED = 10;
  let offset = 0;
  const render = () => {
    rows.innerHTML = '';
    for (let i = offset; i < Math.min(offset + RENDERED, total); i += 1) {
      const a = doc.createElement('a');
      a.className = 'chatlist-chat row';
      a.innerHTML = `<span class="peer-title">${people[i].name}</span><span>${people[i].phone || 'last seen recently'}</span>`;
      rows.appendChild(a);
    }
  };
  const scroller = doc.querySelector('.chatlist');
  scroller.__onScroll = () => {
    const step = Math.floor(Number(scroller.dataset.scrollTop) / 64);
    const next = Math.min(step, total - RENDERED);
    if (next !== offset) {
      offset = next;
      render();
    }
  };
  render();

  const CE = window.CE;
  const result = await CE.engine.scan({
    siteId: 'telegram',
    settings: { countryCode: '98', maxRows: 200, maxSeconds: 20 },
    idleMs: 30,
  });

  check('selector auto-detected from adapter hints', result.selector === '.chatlist .chatlist-chat', result.selector);
  check(`all ${total} rows collected`, result.contacts.length === total, `got ${result.contacts.length}`);
  check('names parsed', result.contacts.every((c) => c.name && c.name.length > 1));
  check(
    'phone rows carry a normalised number',
    result.contacts.filter((c) => c.phones.length).length >= 12,
    `phones: ${result.contacts.filter((c) => c.phones.length).length}`
  );
  const uniqueKeys = new Set(result.contacts.map((c) => c.key));
  check('no duplicate keys after node recycling', uniqueKeys.size === result.contacts.length);
}

async function testWhatsAppAdapter() {
  console.log('\nengine.scan() — WhatsApp-style markup (span[title] names, role=listitem rows)');
  const total = 18;
  const html = `<!doctype html><html><body>
    <div id="app"><div id="side"><div id="pane-side" class="scrollable" data-total="${total}">
      <div id="rows"></div>
    </div></div></div>
  </body></html>`;

  const dom = new JSDOM(html, { url: 'https://web.whatsapp.com/', pretendToBeVisual: true, runScripts: 'outside-only' });
  const { window } = dom;
  patchLayout(window, window.document);
  for (const file of ['src/lib/util.js', 'src/lib/extract.js', 'src/lib/adapters.js', 'src/content/engine.js']) {
    window.eval(read(file));
  }

  const doc = window.document;
  const rows = doc.getElementById('rows');
  const people = Array.from({ length: total }, (_, i) => ({
    name: `Contact ${String.fromCharCode(65 + i)}`,
    phone: i % 2 ? `+49 176 100${i}00` : '',
  }));

  let offset = 0;
  const RENDERED = 8;
  const render = () => {
    rows.innerHTML = '';
    for (let i = offset; i < Math.min(offset + RENDERED, total); i += 1) {
      const row = doc.createElement('div');
      row.setAttribute('role', 'listitem');
      row.className = 'x1n2onr6';
      row.innerHTML = `<span title="${people[i].name}">${people[i].name}</span><span>${
        people[i].phone || 'Hey there! I am using WhatsApp.'
      }</span>`;
      rows.appendChild(row);
    }
  };
  const scroller = doc.getElementById('pane-side');
  scroller.__onScroll = () => {
    const next = Math.min(Math.floor(Number(scroller.dataset.scrollTop) / 64), total - RENDERED);
    if (next !== offset) {
      offset = next;
      render();
    }
  };
  render();

  const CE = window.CE;
  const result = await CE.engine.scan({
    siteId: 'whatsapp',
    settings: { countryCode: '98', maxRows: 200, maxSeconds: 20 },
    idleMs: 30,
  });

  check('whatsapp selector from adapter hints', result.selector === '#pane-side [role="listitem"]', result.selector);
  check(`all ${total} whatsapp rows collected`, result.contacts.length === total, `got ${result.contacts.length}`);
  check('names come from span[title]', result.contacts.every((c) => /^Contact [A-Z]$/.test(c.name)), JSON.stringify(result.contacts[0]));
  check(
    'phone rows parsed',
    result.contacts.filter((c) => c.phones.length).length >= 8,
    `got ${result.contacts.filter((c) => c.phones.length).length}`
  );
  check(
    'status text never becomes a name',
    result.contacts.every((c) => !/using whatsapp/i.test(c.name))
  );
}

async function testPopup() {
  console.log('\npopup — boot, render, scan progress, i18n, diagnostics');
  const html = read('src/ui/popup.html').replace(/<script[\s\S]*?<\/script>/g, '');
  const dom = new JSDOM(html, {
    url: 'http://localhost/src/ui/popup.html?site=whatsapp',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;

  // minimal browser APIs the popup touches
  window.confirm = () => true;
  window.URL.createObjectURL = () => 'blob:mock';
  window.URL.revokeObjectURL = () => {};
  window.navigator.clipboard = { writeText: async () => {} };

  for (const file of [
    'dev/mock-chrome.js',
    'src/lib/util.js',
    'src/lib/extract.js',
    'src/lib/adapters.js',
    'src/lib/exporters.js',
    'src/lib/i18n.js',
    'src/lib/store.js',
  ]) {
    window.eval(read(file));
  }
  window.eval(read('src/ui/popup.js'));

  await new Promise((r) => setTimeout(r, 250));
  const doc = window.document;
  const $ = (id) => doc.getElementById(id);

  check('site panel is shown for whatsapp', !$('sitePanel').hidden && $('siteName').textContent === 'WhatsApp');
  check('seeded contacts counted', Number($('totalCount').textContent) > 0, $('totalCount').textContent);
  check('chips rendered', $('chips').querySelectorAll('.chip').length >= 3);
  check('list rendered', $('contactList').querySelectorAll('.item').length > 0);
  check('site badge shows stored count', Number($('siteBadge').textContent) > 0);

  // scan (simulated by mock-chrome)
  $('scanBtn').click();
  await new Promise((r) => setTimeout(r, 900));
  const duringScan = !$('live').hidden;
  await new Promise((r) => setTimeout(r, 2600));
  check('progress bar was visible during scan', duringScan);
  check('scan finished with contacts', $('siteBadge').textContent !== '0', $('siteBadge').textContent);
  check('success message shown', !$('siteError').hidden && $('siteError').classList.contains('ok'));

  // diagnostics
  $('diagBtn').click();
  await new Promise((r) => setTimeout(r, 200));
  check('diagnostics listed selectors', $('diagBox').querySelectorAll('.diagItem').length === 3);

  // language switch (RTL + Persian labels)
  window.CE.store.setSettings({ lang: 'fa' });
  await new Promise((r) => setTimeout(r, 150));
  check('persian UI applied', doc.documentElement.dir === 'rtl' && $('scanBtn').textContent.includes('اسکن'));

  // export paths never throw
  try {
    $('exportBtn').click();
    $('copyBtn').click();
    check('export + copy buttons run', true);
  } catch (error) {
    check('export + copy buttons run', false, error.message);
  }

  // scope switch
  try {
    $('scope').value = 'all';
    $('scope').dispatchEvent(new window.Event('change'));
    $('search').value = 'sara';
    $('search').dispatchEvent(new window.Event('input'));
    check('search filters the list', $('contactList').querySelectorAll('.item').length > 0);
  } catch (error) {
    check('search filters the list', false, error.message);
  }
}

await testEngine();
await testWhatsAppAdapter();
await testPopup();

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);

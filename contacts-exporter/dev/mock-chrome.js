// ─────────────────────────────────────────────────────────────
// dev/mock-chrome.js — a tiny `chrome.*` stub so the popup can be
// opened in a normal browser tab (the live preview in this repo).
// It is a no-op inside a real extension because chrome.storage exists.
// ─────────────────────────────────────────────────────────────
(() => {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) return; // real extension

  const KEYS = { settings: 'ce.settings', results: 'ce.results', learned: 'ce.learned', live: 'ce.live' };
  const STORAGE_PREFIX = 'ce.mock.';
  const listeners = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const params = new URLSearchParams(location.search);
  const siteParam = params.get('site') || 'telegram';
  const SITE_URLS = {
    telegram: 'https://web.telegram.org/k/',
    whatsapp: 'https://web.whatsapp.com/',
    rubika: 'https://web.rubika.ir/',
    eitaa: 'https://web.eitaa.com/',
  };
  const activeUrl = SITE_URLS[siteParam] || SITE_URLS.telegram;

  function load(key) {
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + key);
      return raw == null ? undefined : JSON.parse(raw);
    } catch {
      return undefined;
    }
  }

  function save(key, value) {
    try {
      localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  }

  function emit(changes) {
    listeners.forEach((fn) => {
      try {
        fn(changes, 'local');
      } catch {
        /* ignore */
      }
    });
  }

  function getMany(keys) {
    const out = {};
    if (keys == null) {
      for (const key of Object.values(KEYS)) out[key] = load(key);
      return out;
    }
    const list = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys);
    for (const key of list) {
      const value = load(key);
      if (value !== undefined) out[key] = value;
    }
    return out;
  }

  function setMany(obj) {
    const changes = {};
    for (const [key, value] of Object.entries(obj)) {
      save(key, value);
      changes[key] = { oldValue: load(key), newValue: value };
    }
    emit(changes);
  }

  const storageLocal = {
    get(keys, callback) {
      const result = getMany(keys);
      if (typeof callback === 'function') {
        setTimeout(() => callback(result), 0);
        return undefined;
      }
      return Promise.resolve(result);
    },
    set(obj, callback) {
      setMany(obj);
      if (typeof callback === 'function') {
        setTimeout(callback, 0);
        return undefined;
      }
      return Promise.resolve();
    },
    remove(keys, callback) {
      const list = Array.isArray(keys) ? keys : [keys];
      list.forEach((key) => localStorage.removeItem(STORAGE_PREFIX + key));
      if (typeof callback === 'function') setTimeout(callback, 0);
      return Promise.resolve();
    },
    clear(callback) {
      Object.values(KEYS).forEach((key) => localStorage.removeItem(STORAGE_PREFIX + key));
      if (typeof callback === 'function') setTimeout(callback, 0);
      return Promise.resolve();
    },
  };

  // ── demo data ────────────────────────────────────────────
  const DEMO = {
    telegram: [
      { name: 'Sara Ahmadi', phones: ['+98 912 345 6789'], username: 'sara_ahmadi' },
      { name: 'Reza Karimi', phones: ['0912 555 1122'], username: '' },
      { name: 'نازنین محمدی', phones: [], username: 'nazanin_m' },
      { name: 'Ali Hosseini', phones: ['+49 176 1234 5678'], username: 'ali_h' },
      { name: 'مریم رضایی', phones: ['0935 210 8899'], username: '' },
      { name: 'Cafe Almas Support', phones: ['+98 21 8877 6655'], username: 'cafe_almas' },
      { name: 'Jonas Weber', phones: ['+49 911 123456'], username: '' },
      { name: 'فروشگاه الماس', phones: [], username: 'almas_shop' },
      { name: 'Hossein Nouri', phones: ['0938 774 2211'], username: '' },
      { name: 'Lena Fischer', phones: ['+49 151 2233 4455'], username: 'lena_f' },
      { name: 'محمد صادقی', phones: ['0912 908 4433'], username: 'm_sadeghi' },
    ],
    whatsapp: [
      { name: 'Jonas Weber', phones: ['+49 176 9988 776'], username: '' },
      { name: 'Sara Ahmadi', phones: ['+98 912 345 6789'], username: '' },
      { name: 'Familie Fischer', phones: ['+49 911 556677'], username: '' },
      { name: 'Ali Hosseini', phones: ['+49 176 1234 5678'], username: '' },
      { name: 'Nuremberg Cafe Group', phones: [], username: '' },
      { name: 'مریم رضایی', phones: ['+989352108899'], username: '' },
    ],
    rubika: [
      { name: 'حسین نوری', phones: ['09387742211'], username: 'hossein_n' },
      { name: 'فاطمه اکبری', phones: ['0912 771 5544'], username: '' },
      { name: 'Sara Ahmadi', phones: ['+98 912 345 6789'], username: 'sara_rb' },
      { name: 'کانال کافه الماس', phones: [], username: 'almas_channel' },
      { name: 'رضا کریمی', phones: ['0912 555 1122'], username: '' },
    ],
    eitaa: [
      { name: 'علی حسینی', phones: ['۰۹۱۲۱۲۳۴۵۶۷'], username: '' },
      { name: 'خانواده رضایی', phones: [], username: '' },
      { name: 'Sara Ahmadi', phones: ['+989123456789'], username: '' },
      { name: 'دفتر فنی الماس', phones: ['021 8877 6655'], username: 'almas_office' },
    ],
  };

  function toRecords(siteId, people) {
    return people.map((p, index) => ({
      name: p.name,
      phones: p.phones,
      username: p.username,
      site: siteId,
      source: siteId,
      raw: `${p.name} ${p.phones[0] || ''} ${p.username ? '@' + p.username : ''}`.trim(),
      at: Date.now() - index * 1000,
      key: `p:${(p.phones[0] || p.name).replace(/\s+/g, '')}`,
    }));
  }

  function seed() {
    if (load(KEYS.results)) return;
    const results = {};
    for (const siteId of ['whatsapp', 'rubika', 'eitaa']) {
      results[siteId] = {
        contacts: toRecords(siteId, DEMO[siteId]),
        updatedAt: Date.now() - 86400000,
        selector: 'demo',
        host: siteId,
        adapter: siteId,
      };
    }
    save(KEYS.results, results);
    save(KEYS.live, {});
    save(KEYS.settings, {
      lang: 'en',
      countryCode: '98',
      maxRows: 5000,
      maxSeconds: 240,
      idleMs: 600,
      requirePhone: false,
      includeRaw: true,
    });
  }

  async function simulateScan(message) {
    const siteId = message?.options?.siteId || siteParam;
    const people = DEMO[siteId] || DEMO.telegram;
    const startedAt = Date.now();

    for (let i = 0; i <= people.length; i += 1) {
      const live = load(KEYS.live) || {};
      live[siteId] = {
        status: i < people.length ? 'scanning' : 'scanning',
        count: i,
        rounds: i,
        elapsed: Date.now() - startedAt,
        selector: '.chatlist-chat',
        startedAt,
      };
      setMany({ [KEYS.live]: live });
      await sleep(190);
    }

    const results = load(KEYS.results) || {};
    const previous = results[siteId]?.contacts || [];
    const merged = [...previous, ...toRecords(siteId, people)];
    const seen = new Set();
    const unique = merged.filter((c) => {
      const key = (c.phones[0] || c.name || '').replace(/\s+/g, '').toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    results[siteId] = {
      contacts: unique,
      updatedAt: Date.now(),
      selector: '.chatlist-chat',
      host: siteId,
      adapter: siteId,
      url: activeUrl,
    };

    const live = load(KEYS.live) || {};
    live[siteId] = {
      status: 'done',
      count: unique.length,
      found: people.length,
      selector: '.chatlist-chat',
      elapsed: Date.now() - startedAt,
      startedAt,
      finishedAt: Date.now(),
    };
    setMany({ [KEYS.results]: results, [KEYS.live]: live });

    return { ok: true, siteId, count: unique.length, found: people.length, selector: '.chatlist-chat', elapsed: Date.now() - startedAt };
  }

  function sendMessage(tabId, message) {
    if (!message || !message.type) return Promise.reject(new Error('No message'));
    switch (message.type) {
      case 'CE_PING':
        return Promise.resolve({ ok: true, site: siteParam });
      case 'CE_SCAN':
        return simulateScan(message);
      case 'CE_DIAGNOSE':
        return Promise.resolve({
          ok: true,
          candidates: [
            { selector: '.chatlist-chat', inParent: 14, matches: 26, sample: 'Sara Ahmadi · last seen recently' },
            { selector: 'div.chat-item', inParent: 9, matches: 9, sample: 'نازنین محمدی · پیام…' },
            { selector: 'li.contact-row', inParent: 6, matches: 6, sample: 'Reza Karimi +98 912 555 1122' },
          ],
        });
      case 'CE_PICK':
        return sleep(700).then(async () => {
          const scan = await simulateScan({ options: { siteId: siteParam } });
          return { ok: true, selector: '.chatlist-chat', matches: 26, sample: 'Sara Ahmadi', scan };
        });
      default:
        return Promise.resolve({ ok: false, error: 'UNKNOWN' });
    }
  }

  window.chrome = {
    runtime: { id: 'preview', lastError: null },
    storage: {
      local: storageLocal,
      onChanged: {
        addListener(fn) {
          if (typeof fn === 'function') listeners.push(fn);
        },
        removeListener(fn) {
          const index = listeners.indexOf(fn);
          if (index >= 0) listeners.splice(index, 1);
        },
      },
    },
    tabs: {
      query: () => Promise.resolve([{ id: 1, url: activeUrl, active: true, title: 'Preview' }]),
      sendMessage: (tabId, message) => sendMessage(tabId, message),
    },
    scripting: {
      executeScript: () => Promise.resolve([]),
    },
  };

  seed();
  window.__CE_PREVIEW__ = { site: siteParam, url: activeUrl };
})();

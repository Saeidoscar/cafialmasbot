// ─────────────────────────────────────────────────────────────
// src/lib/store.js — chrome.storage wrapper (with a safe fallback)
//
// Keys
//   ce.settings  { lang, countryCode, maxRows, maxSeconds, requirePhone, idleMs }
//   ce.results   { [siteId]: { contacts, updatedAt, selector, host, adapter } }
//   ce.learned   { [hostname]: selector }  ← learned by the “Teach me” picker
//   ce.live      { [siteId]: { status, count, startedAt, error, message } }
// ─────────────────────────────────────────────────────────────
(() => {
  const CE = (globalThis.CE = globalThis.CE || {});
  if (CE.store) return;

  const KEYS = {
    settings: 'ce.settings',
    results: 'ce.results',
    learned: 'ce.learned',
    live: 'ce.live',
  };

  const DEFAULT_SETTINGS = {
    lang: 'en',
    countryCode: '', // e.g. "98" — used when a number starts with 0
    maxRows: 5000,
    maxSeconds: 240,
    idleMs: 600,
    requirePhone: false,
    includeRaw: true,
  };

  const memory = new Map();
  const hasExt =
    typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.local;
  const hasLocalStorage = (() => {
    try {
      return typeof localStorage !== 'undefined';
    } catch {
      return false;
    }
  })();

  function rawGet(key) {
    if (hasExt) {
      return new Promise((resolve) => {
        chrome.storage.local.get(key, (res) => resolve(res ? res[key] : undefined));
      });
    }
    if (memory.has(key)) return Promise.resolve(memory.get(key));
    if (hasLocalStorage) {
      try {
        const v = localStorage.getItem(key);
        return Promise.resolve(v == null ? undefined : JSON.parse(v));
      } catch {
        return Promise.resolve(undefined);
      }
    }
    return Promise.resolve(undefined);
  }

  function rawSet(key, value) {
    memory.set(key, value);
    if (hasExt) {
      return new Promise((resolve) => chrome.storage.local.set({ [key]: value }, resolve));
    }
    if (hasLocalStorage) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* quota */
      }
    }
    try {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('ce-store-change', { detail: { key, value } }));
      }
    } catch {
      /* noop */
    }
    return Promise.resolve();
  }

  async function get(key, fallback) {
    const v = await rawGet(key);
    return v === undefined || v === null ? fallback : v;
  }

  async function set(key, value) {
    await rawSet(key, value);
    return value;
  }

  async function getSettings() {
    const stored = await get(KEYS.settings, {});
    return { ...DEFAULT_SETTINGS, ...(stored || {}) };
  }

  async function setSettings(patch) {
    const next = { ...(await getSettings()), ...patch };
    await set(KEYS.settings, next);
    return next;
  }

  const getResults = () => get(KEYS.results, {});
  const setResults = (r) => set(KEYS.results, r);
  const getLearned = () => get(KEYS.learned, {});
  const getLive = () => get(KEYS.live, {});

  /** Merge freshly scanned contacts for one site into the stored results. */
  async function mergeSiteResults(siteId, payload) {
    const results = await getResults();
    const prev = results[siteId] || { contacts: [] };
    const merged = CE.extract.mergeRecords(
      [...(prev.contacts || []), ...(payload.contacts || [])],
      await getSettings()
    );
    results[siteId] = {
      ...prev,
      ...payload,
      contacts: merged,
      updatedAt: Date.now(),
      firstScanAt: prev.firstScanAt || payload.updatedAt || Date.now(),
    };
    await setResults(results);
    return results[siteId];
  }

  async function clearSite(siteId) {
    const results = await getResults();
    delete results[siteId];
    await setResults(results);
  }

  async function clearAll() {
    await setResults({});
    await set(KEYS.live, {});
  }

  async function setLive(siteId, patch) {
    const live = await getLive();
    live[siteId] = { ...(live[siteId] || {}), ...patch, at: Date.now() };
    await set(KEYS.live, live);
    return live[siteId];
  }

  function onChange(callback) {
    if (hasExt) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        const updates = {};
        for (const [k, v] of Object.entries(changes)) updates[k] = v.newValue;
        callback(updates);
      });
    } else if (typeof window !== 'undefined') {
      window.addEventListener('ce-store-change', (e) => {
        callback({ [e.detail.key]: e.detail.value });
      });
    }
  }

  CE.store = {
    KEYS,
    DEFAULT_SETTINGS,
    get,
    set,
    getSettings,
    setSettings,
    getResults,
    setResults,
    getLearned,
    getLive,
    setLive,
    mergeSiteResults,
    clearSite,
    clearAll,
    onChange,
  };
})();

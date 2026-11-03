// ─────────────────────────────────────────────────────────────
// src/lib/util.js — tiny shared helpers (no dependencies)
// Loaded as a classic script in the extension and imported
// directly by the Node test-suite.
// ─────────────────────────────────────────────────────────────
(() => {
  const CE = (globalThis.CE = globalThis.CE || {});
  if (CE.util) return;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Persian / Arabic-Indic digits → ASCII digits. */
  function normalizeDigits(input) {
    if (input == null) return '';
    return String(input).replace(/[\u06F0-\u06F9\u0660-\u0669]/g, (ch) =>
      String(ch.charCodeAt(0) & 0xf)
    );
  }

  /** Collapse whitespace (incl. ZWNJ / RTL marks) for comparisons. */
  function squash(input) {
    return normalizeDigits(input)
      .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Lower-cased, punctuation-free key used for de-duplication. */
  function nameKey(input) {
    return squash(input)
      .toLowerCase()
      .replace(/[يىۍ]/g, 'ی')
      .replace(/[ك]/g, 'ک')
      .replace(/[أإآ]/g, 'ا')
      .replace(/[^\p{L}\p{N} ]+/gu, '')
      .replace(/ +/g, ' ')
      .trim();
  }

  const hasChromeStorage = () =>
    typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.local;

  const nowIso = () => new Date().toISOString();

  function formatDuration(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[c]));
  }

  /** Throttle: run at most once per `wait` ms, always keeping the last call. */
  function throttle(fn, wait) {
    let last = 0;
    let timer = null;
    return (...args) => {
      const now = Date.now();
      const remaining = wait - (now - last);
      if (remaining <= 0) {
        last = now;
        fn(...args);
      } else if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          last = Date.now();
          fn(...args);
        }, remaining);
      }
    };
  }

  CE.util = {
    sleep,
    normalizeDigits,
    squash,
    nameKey,
    hasChromeStorage,
    nowIso,
    formatDuration,
    escapeHtml,
    throttle,
  };
})();

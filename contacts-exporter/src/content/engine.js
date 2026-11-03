// ─────────────────────────────────────────────────────────────
// src/content/engine.js — the actual scanning engine (runs in the page)
//
// Strategy
//   1. Find row elements: explicit selector → learned selector → adapter hints
//   2. Find the scroll container by climbing from a row to the nearest
//      scrollable ancestor (works on all four web apps)
//   3. Scroll step by step, harvesting rows as they render (virtual lists
//      recycle DOM nodes, so we harvest while scrolling and de-duplicate)
//   4. Extract name / phones / @username from each row's text
//
// Two escape hatches exist because these web apps change their DOM often:
//   pickSelector() — the user clicks one row, we derive a selector
//   diagnose()     — lists the most repeated row-like selectors on the page
// ─────────────────────────────────────────────────────────────
(() => {
  const CE = (globalThis.CE = globalThis.CE || {});
  if (CE.engine) return;
  const U = CE.util;

  class ScanError extends Error {
    constructor(code, message) {
      super(message || code);
      this.name = 'ScanError';
      this.code = code;
    }
  }

  const JUNK_CLASS = /^(active|selected|open|opened|hover|focus|focused|visible|hidden|show|shown|disabled|loaded|rtl|ltr|dark|light)$/i;

  const visibleCache = new WeakSet();

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    if (visibleCache.has(el)) return true;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    if (Number(style.opacity) === 0) return false;
    visibleCache.add(el);
    return true;
  }

  function usableClass(cls) {
    if (!cls || cls.length < 3 || cls.length > 40) return false;
    if (JUNK_CLASS.test(cls)) return false;
    if (!/^[A-Za-z_][\w-]*$/.test(cls)) return false;
    return true;
  }

  function countOf(selector) {
    try {
      return document.querySelectorAll(selector).length;
    } catch {
      return 0;
    }
  }

  function findRows(selectors) {
    for (const selector of selectors) {
      let nodes;
      try {
        nodes = Array.from(document.querySelectorAll(selector));
      } catch {
        continue;
      }
      const visible = nodes.filter(isVisible);
      if (visible.length) return { selector, nodes: visible, node: visible[0] };
    }
    return null;
  }

  function resolveScroller(node, hints = []) {
    for (const hint of hints) {
      let el;
      try {
        el = document.querySelector(hint);
      } catch {
        continue;
      }
      if (el && el.scrollHeight > el.clientHeight + 8) return el;
    }
    let cur = node.parentElement;
    while (cur && cur !== document.documentElement && cur !== document.body) {
      const style = getComputedStyle(cur);
      const scrollable = /(auto|scroll|overlay)/.test(style.overflowY + style.overflow);
      if (scrollable && cur.scrollHeight > cur.clientHeight + 8) return cur;
      cur = cur.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  function waitForGrowth(scroller, beforeHeight, timeout) {
    return new Promise((resolve) => {
      let settled = false;
      let target = scroller;
      if (!target || target === document.scrollingElement) target = document.body;

      const finish = (value) => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        clearTimeout(timer);
        resolve(value);
      };

      const observer = new MutationObserver(() => {
        if (scroller.scrollHeight > beforeHeight) setTimeout(() => finish(true), 140);
      });
      try {
        observer.observe(target, { childList: true, subtree: true, characterData: true });
      } catch {
        /* detached */
      }
      const timer = setTimeout(() => finish(scroller.scrollHeight > beforeHeight), timeout);
    });
  }

  const uniq = (list) => [...new Set(list.filter(Boolean))];

  /**
   * Scroll a list and collect every contact row it renders.
   * @returns {Promise<{contacts: object[], selector: string, rounds: number, elapsed: number}>}
   */
  async function scan(options = {}) {
    const site = CE.adapters.sites[options.siteId] || {};
    const settings = options.settings || {};
    const maxRows = Number(options.maxRows || settings.maxRows) || 5000;
    const maxSeconds = Number(options.maxSeconds || settings.maxSeconds) || 240;
    const idleMs = Number(options.idleMs || settings.idleMs) || 600;
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
    const startedAt = Date.now();

    const selectors = uniq([
      options.selector,
      ...(options.learned || []),
      ...(site.selectors || []),
    ]);
    if (!selectors.length) throw new ScanError('NO_SELECTORS', 'No selectors to try for this site.');

    const found = findRows(selectors);
    if (!found) {
      throw new ScanError(
        'NO_ROWS',
        'No contact rows matched. Open the contacts/chat panel and scroll once, or use “Teach me”.'
      );
    }

    const selector = found.selector;
    const scroller = resolveScroller(found.node, site.scrollSelectors);
    const acc = new Map();
    const initialScrollTop = scroller.scrollTop || 0;

    const lastText = new WeakMap();
    const harvest = () => {
      let added = 0;
      // Re-query every round: virtual lists replace the row nodes as we scroll.
      const nodes = Array.from(document.querySelectorAll(selector));
      for (const el of nodes) {
        if (!isVisible(el)) continue;
        let text;
        try {
          text = el.innerText || el.textContent || '';
        } catch {
          continue;
        }
        if (!text) continue;
        if (lastText.get(el) === text) continue; // unchanged since the last round
        lastText.set(el, text);
        const rec = CE.extract.parseRow(el, site, { site: site.id, settings });
        if (!rec) continue;
        if (settings.requirePhone && !(rec.phones || []).length) continue;
        const prev = acc.get(rec.key);
        if (!prev) {
          acc.set(rec.key, rec);
          added++;
        } else {
          if (!prev.name && rec.name) prev.name = rec.name;
          if (!prev.username && rec.username) prev.username = rec.username;
          for (const p of rec.phones || []) if (!prev.phones.includes(p)) prev.phones.push(p);
        }
      }
      return added;
    };

    const report = (extra) =>
      onProgress({
        count: acc.size,
        selector,
        elapsed: Date.now() - startedAt,
        ...extra,
      });

    const stepSize = Math.max(140, Math.floor((scroller.clientHeight || 480) * 0.85));
    let rounds = 0;
    let stale = 0;
    let lastCount = -1;
    let reason = 'finished';

    // Start from the top so nothing above the current scroll position is missed.
    try {
      scroller.scrollTop = 0;
    } catch {
      /* ignore */
    }
    await U.sleep(120);

    while (rounds < 900) {
      rounds++;
      harvest();
      report({ rounds });

      if (acc.size >= maxRows) {
        reason = 'maxRows';
        break;
      }
      if (Date.now() - startedAt > maxSeconds * 1000) {
        reason = 'timeout';
        break;
      }
      if (stale >= 6) {
        reason = 'end';
        break;
      }

      const maxTop = Math.max(0, scroller.scrollHeight - (scroller.clientHeight || 0));
      const atBottom = scroller.scrollTop >= maxTop - 2;

      if (atBottom) {
        // Bottom of the rendered window: give the app a chance to load more.
        let grew = false;
        for (let attempt = 0; attempt < 3 && !grew; attempt += 1) {
          const beforeHeight = scroller.scrollHeight;
          grew = await waitForGrowth(scroller, beforeHeight, idleMs);
          harvest();
        }
        if (!grew && acc.size === lastCount) stale++;
        else stale = 0;
        lastCount = acc.size;
        if (!grew) {
          reason = 'end';
          break;
        }
        continue;
      }

      const beforeTop = scroller.scrollTop;
      const nextTop = Math.min(beforeTop + stepSize, maxTop);
      scroller.scrollTop = nextTop;
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
      await U.sleep(60);

      // Wait for the newly exposed rows (or for the list to grow).
      const beforeHeight = scroller.scrollHeight;
      await waitForGrowth(scroller, beforeHeight, Math.min(idleMs, 400));
      harvest();

      if (acc.size === lastCount && Math.abs(scroller.scrollTop - beforeTop) < 2) stale++;
      else stale = 0;
      lastCount = acc.size;
    }

    harvest();
    report({ rounds, done: true, reason });

    try {
      scroller.scrollTop = initialScrollTop;
    } catch {
      /* ignore */
    }

    const contacts = [...acc.values()];
    return { contacts, selector, rounds, elapsed: Date.now() - startedAt, scroller: describeEl(scroller) };
  }

  function describeEl(el) {
    if (!el) return '';
    const tag = el.tagName ? el.tagName.toLowerCase() : 'window';
    const id = el.id ? `#${el.id}` : '';
    const cls = el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
    return `${tag}${id}${cls}`;
  }

  // ── selector helpers ────────────────────────────────────────
  function signatureOf(el) {
    const tag = el.tagName.toLowerCase();
    const classes = [...(el.classList || [])].filter(usableClass).slice(0, 2);
    return tag + classes.map((c) => `.${CSS.escape(c)}`).join('');
  }

  function cssPath(el) {
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.body && parts.length < 8) {
      if (cur.id) {
        parts.unshift(`#${CSS.escape(cur.id)}`);
        break;
      }
      const tag = cur.tagName.toLowerCase();
      const parent = cur.parentElement;
      if (!parent) {
        parts.unshift(tag);
        break;
      }
      const sameTag = [...parent.children].filter((c) => c.tagName === cur.tagName);
      const index = sameTag.indexOf(cur) + 1;
      parts.unshift(sameTag.length > 1 ? `${tag}:nth-of-type(${index})` : tag);
      cur = parent;
    }
    return parts.join(' > ') || 'body';
  }

  /** Derive a repeating, list-like selector from one example row. */
  function deriveSelector(el) {
    if (!el || el.nodeType !== 1) return '';
    const tag = el.tagName.toLowerCase();
    if (tag === 'html' || tag === 'body') return '';

    const classes = [...(el.classList || [])].filter(usableClass).slice(0, 4);
    for (let i = Math.min(classes.length, 3); i >= 1; i--) {
      const selector = tag + classes.slice(0, i).map((c) => `.${CSS.escape(c)}`).join('');
      const n = countOf(selector);
      if (n >= 2 && n <= 6000) return selector;
    }

    for (const attr of ['data-testid', 'data-peer-id', 'role']) {
      const value = el.getAttribute(attr);
      if (!value || value.length > 50) continue;
      const selector = `${tag}[${attr}="${value.replace(/"/g, '\\"')}"]`;
      const n = countOf(selector);
      if (n >= 2 && n <= 6000) return selector;
    }

    let cur = el.parentElement;
    let depth = 0;
    while (cur && cur !== document.body && depth < 5) {
      const sameTag = [...cur.children].filter((c) => c.tagName === el.tagName).length;
      if (sameTag >= 2) {
        const selector = `${cssPath(cur)} > ${tag}`;
        if (countOf(selector) >= 2) return selector;
      }
      cur = cur.parentElement;
      depth++;
    }
    return cssPath(el);
  }

  /** Repeated sibling selectors on the page — used by the “Diagnose” panel. */
  function diagnose(limit = 10) {
    const found = new Map();
    const parents = new Set();
    const all = document.querySelectorAll('body *');
    const max = Math.min(all.length, 6000);
    for (let i = 0; i < max; i++) {
      if (all[i].children.length >= 4) parents.add(all[i]);
    }

    for (const parent of parents) {
      if (!isVisible(parent)) continue;
      const kids = [...parent.children];
      const groups = new Map();
      for (const kid of kids) {
        const sig = signatureOf(kid);
        if (!sig) continue;
        if (!groups.has(sig)) groups.set(sig, []);
        groups.get(sig).push(kid);
      }
      for (const [sig, members] of groups) {
        if (members.length < 4) continue;
        const matches = countOf(sig);
        if (matches < 4 || matches > 8000) continue;
        const rect = parent.getBoundingClientRect();
        const score =
          members.length * 2 +
          Math.min(matches, 300) +
          Math.min(rect.height, 900) / 50 +
          (getComputedStyle(parent).overflowY === 'auto' ? 60 : 0);
        const prev = found.get(sig);
        if (prev && prev.score >= score) continue;
        found.set(sig, {
          selector: sig,
          inParent: members.length,
          matches,
          score,
          sample: U.squash(members[0].innerText || '').slice(0, 90),
        });
      }
    }

    return [...found.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ score, ...rest }) => rest);
  }

  // ── “Teach me”: click one row, we learn the selector ─────────
  function pickSelector(lang = 'en') {
    const text = {
      en: {
        title: 'Click one contact row (press Esc to cancel)',
        sub: 'The exporter learns the repeating pattern and scans the whole list.',
      },
      fa: {
        title: 'روی یک ردیف مخاطب کلیک کنید (برای لغو Esc)',
        sub: 'افزونه الگوی تکرارشونده را یاد می‌گیرد و کل لیست را اسکن می‌کند.',
      },
    }[lang === 'fa' ? 'fa' : 'en'];

    return new Promise((resolve) => {
      const box = document.createElement('div');
      box.setAttribute('data-ce-ui', '1');
      box.style.cssText = [
        'position:fixed',
        'z-index:2147483647',
        'pointer-events:none',
        'border:2px solid #22d3ee',
        'background:rgba(34,211,238,.18)',
        'border-radius:8px',
        'box-shadow:0 0 0 9999px rgba(9,12,20,.15)',
        'transition:all .04s linear',
      ].join(';');

      const bar = document.createElement('div');
      bar.setAttribute('data-ce-ui', '1');
      bar.style.cssText = [
        'position:fixed',
        'left:50%',
        'bottom:22px',
        'transform:translateX(-50%)',
        'z-index:2147483647',
        'background:#0b1220',
        'color:#e6edf7',
        'font:13px/1.5 system-ui,-apple-system,Segoe UI,Tahoma,sans-serif',
        'padding:10px 16px',
        'border-radius:12px',
        'border:1px solid #22d3ee66',
        'box-shadow:0 12px 40px rgba(0,0,0,.5)',
        'pointer-events:none',
        'max-width:90vw',
        'text-align:center',
        'direction:' + (lang === 'fa' ? 'rtl' : 'ltr'),
      ].join(';');
      bar.innerHTML = `<b>${text.title}</b><br><span style="opacity:.65;font-size:12px">${text.sub}</span>`;

      document.documentElement.append(box, bar);

      let current = null;

      const onMove = (event) => {
        const el = document.elementFromPoint(event.clientX, event.clientY);
        if (!el || el.closest('[data-ce-ui]')) return;
        current = el;
        const rect = el.getBoundingClientRect();
        box.style.left = `${rect.left}px`;
        box.style.top = `${rect.top}px`;
        box.style.width = `${rect.width}px`;
        box.style.height = `${rect.height}px`;
      };

      const cleanup = () => {
        document.removeEventListener('mousemove', onMove, true);
        document.removeEventListener('click', onClick, true);
        document.removeEventListener('keydown', onKey, true);
        box.remove();
        bar.remove();
      };

      const onClick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        const el = current || document.elementFromPoint(event.clientX, event.clientY);
        cleanup();
        if (!el) return resolve(null);
        const selector = deriveSelector(el);
        resolve({ selector, matches: countOf(selector), sample: U.squash(el.innerText || '').slice(0, 90) });
      };

      const onKey = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          cleanup();
          resolve(null);
        }
      };

      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('click', onClick, true);
      document.addEventListener('keydown', onKey, true);
    });
  }

  CE.engine = {
    ScanError,
    scan,
    pickSelector,
    diagnose,
    deriveSelector,
    resolveScroller,
    findRows,
    isVisible,
    cssPath,
  };
})();

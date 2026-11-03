// ─────────────────────────────────────────────────────────────
// src/ui/popup.js — the whole popup UI
// ─────────────────────────────────────────────────────────────
(() => {
  const CE = globalThis.CE;
  const $ = (sel) => document.querySelector(sel);

  const CONTENT_FILES = [
    'src/lib/util.js',
    'src/lib/extract.js',
    'src/lib/adapters.js',
    'src/lib/store.js',
    'src/content/engine.js',
    'src/content/content.js',
  ];

  const state = {
    lang: 'en',
    settings: null,
    results: {},
    live: {},
    site: null,
    tab: null,
    search: '',
    filterSite: null,
    busy: false,
    diag: null,
    merged: [],
    timer: null,
  };

  const t = (key, vars) => CE.i18n.t(state.lang, key, vars);
  const appLabel = (site) => (state.lang === 'fa' ? site.labelFa || site.label : site.label);

  // ── DOM shortcuts ────────────────────────────────────────
  const refs = {};
  function cacheRefs() {
    [
      'langBtn', 'unsupported', 'openList', 'sitePanel', 'siteDot', 'siteName', 'siteMeta',
      'siteBadge', 'siteHint', 'scanBtn', 'teachBtn', 'diagBtn', 'live', 'liveBar', 'liveText',
      'siteError', 'diagBox', 'chips', 'totalCount', 'totalMeta', 'scope', 'format',
      'exportBtn', 'copyBtn', 'search', 'contactList', 'listEmpty', 'settingsBox',
      'countryCode', 'maxRows', 'maxSeconds', 'langSelect', 'requirePhone', 'includeRaw',
      'clearSiteBtn', 'clearAllBtn', 'lastScan', 'main',
    ].forEach((id) => {
      refs[id] = document.getElementById(id);
    });
  }

  // ── data helpers ─────────────────────────────────────────
  function flatten(results = state.results) {
    const out = [];
    for (const [siteId, entry] of Object.entries(results || {})) {
      for (const c of entry?.contacts || []) {
        out.push({
          ...c,
          site: c.site || siteId,
          sites: c.sites && c.sites.length ? c.sites : [siteId],
        });
      }
    }
    return out;
  }

  function mergedAll() {
    return CE.extract.mergeAcrossSites(flatten(), state.settings || {});
  }

  function scopedContacts() {
    const scope = refs.scope?.value || 'all';
    const merged = state.merged || [];
    if (scope === 'all') return merged;
    return merged.filter((c) => (c.sites || []).includes(scope));
  }

  function visibleForList() {
    let list = scopedContacts();
    if (state.filterSite && (refs.scope?.value || 'all') === 'all') {
      list = list.filter((c) => (c.sites || []).includes(state.filterSite));
    }
    const q = state.search.trim().toLowerCase();
    if (q) {
      const digits = q.replace(/[^\d+]/g, '');
      list = list.filter((c) => {
        if ((c.name || '').toLowerCase().includes(q)) return true;
        if ((c.username || '').toLowerCase().includes(q)) return true;
        if (digits.length >= 3 && (c.phones || []).some((p) => p.replace(/[^\d+]/g, '').includes(digits))) {
          return true;
        }
        return false;
      });
    }
    return list;
  }

  // ── rendering ────────────────────────────────────────────
  function applyLang() {
    CE.i18n.apply(state.lang, document);
    refs.langBtn.textContent = state.lang === 'fa' ? 'EN' : 'فا';
    if (refs.langSelect) refs.langSelect.value = state.lang;
  }

  function renderSitePanel() {
    const site = state.site;
    refs.unsupported.hidden = !!site;
    refs.sitePanel.hidden = !site;
    if (!site) {
      renderOpenList();
      return;
    }

    refs.sitePanel.style.setProperty('--site', site.color);
    refs.siteName.textContent = appLabel(site);
    refs.siteHint.textContent = site.hint?.[state.lang] || site.hint?.en || '';

    const entry = state.results?.[site.id];
    const count = entry?.contacts?.length || 0;
    refs.siteBadge.textContent = String(count);
    refs.siteMeta.textContent = t('contactsOne', { n: count });

    const live = state.live?.[site.id];
    const scanning = live && live.status === 'scanning';
    refs.live.hidden = !scanning;
    if (scanning) renderLive(live);

    refs.scanBtn.disabled = state.busy;
    refs.teachBtn.disabled = state.busy;
    refs.diagBtn.disabled = state.busy;
    refs.scanBtn.textContent = state.busy ? t('scanning') : t('scan');
  }

  function renderOpenList() {
    refs.openList.innerHTML = '';
    for (const site of CE.adapters.list()) {
      const a = document.createElement('a');
      a.className = 'openItem';
      a.href = site.openUrl;
      a.target = '_blank';
      a.rel = 'noopener';
      a.style.setProperty('--c', site.color);
      a.innerHTML = `<span class="chipDot"></span><span>${site.label}</span><span class="go">${t('open')} ↗</span>`;
      refs.openList.appendChild(a);
    }
  }

  function renderLive(live) {
    const elapsed = live.startedAt ? Date.now() - live.startedAt : live.elapsed || 0;
    refs.liveBar.style.width = `${Math.min(96, 8 + Math.log10((live.count || 0) + 2) * 30)}%`;
    refs.liveText.textContent = t('progress', {
      n: live.count || 0,
      t: CE.util.formatDuration(elapsed),
    });
  }

  function renderChips() {
    refs.chips.innerHTML = '';
    const withData = CE.adapters
      .list()
      .map((site) => ({ site, entry: state.results?.[site.id] }))
      .filter(({ entry }) => entry && (entry.contacts || []).length);

    if (!withData.length) {
      refs.chips.innerHTML = `<span class="muted tiny">${CE.util.escapeHtml(t('empty'))}</span>`;
      return;
    }

    for (const { site, entry } of withData) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip';
      btn.style.setProperty('--chip', site.color);
      btn.setAttribute('aria-pressed', String(state.filterSite === site.id));
      btn.innerHTML = `<span class="chipDot"></span><span>${CE.util.escapeHtml(appLabel(site))}</span><span class="n">${entry.contacts.length}</span>`;
      btn.addEventListener('click', () => {
        state.filterSite = state.filterSite === site.id ? null : site.id;
        render();
      });
      refs.chips.appendChild(btn);
    }
  }

  function renderTotals() {
    const merged = state.merged;
    refs.totalCount.textContent = String(merged.length);
    const apps = new Set();
    merged.forEach((c) => (c.sites || []).forEach((s) => apps.add(s)));
    refs.totalMeta.textContent =
      apps.size > 1
        ? t('contactsAll', { n: merged.length, m: apps.size })
        : t('contactsOne', { n: merged.length });
  }

  function renderScopeOptions() {
    const current = refs.scope.value || 'all';
    const sitesWithData = CE.adapters
      .list()
      .filter((site) => (state.results?.[site.id]?.contacts || []).length);
    refs.scope.innerHTML = '';
    const all = document.createElement('option');
    all.value = 'all';
    all.textContent = t('scopeAll');
    refs.scope.appendChild(all);
    for (const site of sitesWithData) {
      const opt = document.createElement('option');
      opt.value = site.id;
      opt.textContent = `${t('scopeSite')} — ${appLabel(site)}`;
      refs.scope.appendChild(opt);
    }
    refs.scope.value = [...refs.scope.options].some((o) => o.value === current) ? current : 'all';
  }

  function renderFormatOptions() {
    const current = refs.format.value || 'csv';
    refs.format.innerHTML = '';
    for (const key of ['csv', 'vcf', 'gcsv', 'json', 'txt']) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = t(
        { csv: 'formatCsv', vcf: 'formatVcf', gcsv: 'formatGcsv', json: 'formatJson', txt: 'formatTxt' }[key]
      );
      refs.format.appendChild(opt);
    }
    refs.format.value = current;
  }

  function renderList() {
    const list = visibleForList();
    refs.contactList.innerHTML = '';

    if (!list.length) {
      refs.listEmpty.hidden = false;
      refs.listEmpty.textContent = state.merged.length ? t('emptySearch') : t('empty');
      return;
    }
    refs.listEmpty.hidden = true;

    const shown = list.slice(0, 250);
    const frag = document.createDocumentFragment();
    for (const c of shown) {
      const li = document.createElement('li');
      li.className = 'item';
      const label = c.name || (c.phones || [])[0] || (c.username ? `@${c.username}` : '?');
      const initial = (c.name || label || '?').trim().charAt(0).toUpperCase();

      const avatar = document.createElement('span');
      avatar.className = 'avatar';
      avatar.textContent = initial;

      const main = document.createElement('div');
      main.className = 'itemMain';
      const nameEl = document.createElement('div');
      nameEl.className = 'itemName';
      nameEl.textContent = label;
      const metaEl = document.createElement('div');
      metaEl.className = 'itemMeta';
      const phones = (c.phones || []).map((p) => CE.extract.normalizePhone(p, state.settings?.countryCode || '') || p);
      metaEl.textContent =
        phones.join(' · ') || (c.username ? `@${c.username}` : c.raw || t('noPhone'));

      main.append(nameEl, metaEl);

      const pips = document.createElement('span');
      pips.className = 'itemSites';
      (c.sites || []).forEach((id) => {
        const pip = document.createElement('span');
        pip.className = 'sitePip';
        pip.style.setProperty('--c', CE.adapters.sites[id]?.color || '#22d3ee');
        pip.title = CE.adapters.sites[id]?.label || id;
        pips.appendChild(pip);
      });

      li.append(avatar, main, pips);
      frag.appendChild(li);
    }
    refs.contactList.appendChild(frag);

    if (list.length > shown.length) {
      const more = document.createElement('li');
      more.className = 'item';
      more.innerHTML = `<span class="muted tiny">+${list.length - shown.length}</span>`;
      refs.contactList.appendChild(more);
    }
  }

  function renderSettings() {
    const s = state.settings || {};
    if (document.activeElement !== refs.countryCode) refs.countryCode.value = s.countryCode || '';
    if (document.activeElement !== refs.maxRows) refs.maxRows.value = String(s.maxRows || 5000);
    if (document.activeElement !== refs.maxSeconds) refs.maxSeconds.value = String(s.maxSeconds || 240);
    refs.requirePhone.checked = !!s.requirePhone;
    refs.includeRaw.checked = s.includeRaw !== false;
    refs.langSelect.value = s.lang || 'en';

    const entry = state.site ? state.results?.[state.site.id] : null;
    const when = entry?.updatedAt ? new Date(entry.updatedAt).toLocaleString() : t('never');
    refs.lastScan.textContent = `${t('lastScan')}: ${when}`;
    refs.clearSiteBtn.disabled = !state.site;
  }

  function render() {
    state.merged = mergedAll();
    applyLang();
    renderSitePanel();
    renderChips();
    renderTotals();
    renderScopeOptions();
    renderFormatOptions();
    renderList();
    renderSettings();
    const scoped = scopedContacts();
    refs.exportBtn.disabled = !scoped.length;
    refs.copyBtn.disabled = !scoped.length;
  }

  // ── messaging ────────────────────────────────────────────
  async function sendToTab(message) {
    if (!state.tab?.id) throw new Error('No active tab');
    try {
      return await chrome.tabs.sendMessage(state.tab.id, message);
    } catch (firstError) {
      // Content script not injected yet (page opened before install): inject and retry.
      if (!chrome.scripting) throw firstError;
      await chrome.scripting.executeScript({ target: { tabId: state.tab.id }, files: CONTENT_FILES });
      await CE.util.sleep(200);
      return chrome.tabs.sendMessage(state.tab.id, message);
    }
  }

  // ── actions ──────────────────────────────────────────────
  function showError(payload) {
    const code = payload?.error || 'ERROR';
    const map = {
      NO_ROWS: ['errNoRows'],
      BUSY: ['errBusy'],
      CANCELLED: ['errCancelled'],
    };
    const key = map[code]?.[0];
    refs.siteError.hidden = false;
    refs.siteError.classList.remove('ok');
    refs.siteError.dataset.kind = 'error';
    refs.siteError.textContent = key
      ? t(key)
      : `${t('scanFailed')}: ${payload?.message || code}`;
  }

  function showOk(text) {
    refs.siteError.hidden = false;
    refs.siteError.classList.add('ok');
    refs.siteError.dataset.kind = 'ok';
    refs.siteError.textContent = text;
  }

  function clearMessages() {
    refs.siteError.hidden = true;
    refs.siteError.textContent = '';
    refs.siteError.dataset.kind = '';
    refs.diagBox.hidden = true;
    refs.diagBox.innerHTML = '';
  }

  async function refresh() {
    state.results = (await CE.store.getResults()) || {};
    state.live = (await CE.store.getLive()) || {};
  }

  async function scan(selector = '') {
    if (!state.site || state.busy) return;
    clearMessages();
    state.busy = true;
    refs.scanBtn.disabled = true;
    refs.teachBtn.disabled = true;
    refs.diagBtn.disabled = true;
    refs.scanBtn.textContent = t('scanning');

    await CE.store.setLive(state.site.id, {
      status: 'scanning',
      count: 0,
      rounds: 0,
      elapsed: 0,
      selector,
      startedAt: Date.now(),
      message: '',
    });
    state.live = (await CE.store.getLive()) || {};
    renderSitePanel();

    try {
      const res = await sendToTab({ type: 'CE_SCAN', options: { siteId: state.site.id, selector } });
      await refresh();
      if (res && res.ok) {
        showOk(`${t('scanDone', { n: res.count })}${res.selector ? ` · ${res.selector}` : ''}`);
      } else {
        showError(res || { error: 'ERROR' });
      }
    } catch (error) {
      showError({ error: 'TAB', message: error.message });
    } finally {
      state.busy = false;
      refs.scanBtn.textContent = t('scan');
      await refresh();
      render();
    }
  }

  async function teach() {
    if (!state.site || state.busy) return;
    clearMessages();
    try {
      const res = await sendToTab({ type: 'CE_PICK', lang: state.lang });
      await refresh();
      if (res && res.ok) {
        const scanInfo = res.scan || {};
        showOk(
          `${t('teachResult')}: ${res.selector} · ${scanInfo.ok === false ? t('scanFailed') : t('scanDone', { n: scanInfo.count ?? 0 })}`
        );
      } else if (res && res.cancelled) {
        showError({ error: 'CANCELLED' });
      } else {
        showError(res || { error: 'ERROR' });
      }
    } catch (error) {
      showError({ error: 'TAB', message: error.message });
    } finally {
      render();
    }
  }

  async function diagnose() {
    if (!state.site) return;
    clearMessages();
    try {
      const res = await sendToTab({ type: 'CE_DIAGNOSE' });
      const candidates = (res && res.candidates) || [];
      state.diag = candidates;
      refs.diagBox.hidden = false;
      refs.diagBox.innerHTML = '';

      const title = document.createElement('div');
      title.className = 'diagTitle';
      title.textContent = candidates.length ? t('diagTitle') : t('diagEmpty');
      refs.diagBox.appendChild(title);

      for (const cand of candidates.slice(0, 8)) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'diagItem';
        btn.innerHTML = `<code>${CE.util.escapeHtml(cand.selector)}</code><span class="sample">${CE.util.escapeHtml(
          cand.sample || ''
        )}</span><span class="n">${cand.matches}</span>`;
        btn.addEventListener('click', () => scan(cand.selector));
        refs.diagBox.appendChild(btn);
      }
    } catch (error) {
      showError({ error: 'TAB', message: error.message });
    }
  }

  async function exportNow() {
    const list = scopedContacts();
    if (!list.length) return;
    const format = refs.format.value || 'csv';
    const scope = refs.scope.value || 'all';
    const { body, mime } = CE.exporters.serialize(format, list, state.settings, {
      scope,
      app: scope === 'all' ? 'all' : CE.adapters.sites[scope]?.label || scope,
    });
    const name = CE.exporters.filename(format, scope === 'all' ? 'all-apps' : scope, list.length);
    CE.exporters.download(body, name, mime);
    showOk(`${t('exportBtn')} ✓ ${list.length} · ${name}`);
  }

  async function copyCsv() {
    const list = scopedContacts();
    if (!list.length) return;
    const csv = CE.exporters.toCSV(list, state.settings);
    try {
      await navigator.clipboard.writeText(csv);
      refs.copyBtn.textContent = t('copied');
      setTimeout(() => {
        refs.copyBtn.textContent = t('copyBtn');
      }, 1600);
    } catch {
      CE.exporters.download(csv, CE.exporters.filename('csv', 'clipboard', list.length), 'text/csv;charset=utf-8');
    }
  }

  // ── settings ─────────────────────────────────────────────
  async function patchSettings(patch) {
    state.settings = await CE.store.setSettings(patch);
    render();
  }

  function bindEvents() {
    refs.langBtn.addEventListener('click', () => patchSettings({ lang: state.lang === 'fa' ? 'en' : 'fa' }));
    refs.langSelect.addEventListener('change', () => patchSettings({ lang: refs.langSelect.value }));
    refs.scanBtn.addEventListener('click', () => scan());
    refs.teachBtn.addEventListener('click', teach);
    refs.diagBtn.addEventListener('click', diagnose);
    refs.exportBtn.addEventListener('click', exportNow);
    refs.copyBtn.addEventListener('click', copyCsv);
    refs.search.addEventListener('input', () => {
      state.search = refs.search.value;
      renderList();
    });
    refs.scope.addEventListener('change', () => {
      renderList();
      const scoped = scopedContacts();
      refs.exportBtn.disabled = !scoped.length;
      refs.copyBtn.disabled = !scoped.length;
    });

    const numeric = (value, fallback) => {
      const n = Number(String(value).replace(/[^\d]/g, ''));
      return Number.isFinite(n) && n > 0 ? n : fallback;
    };
    refs.countryCode.addEventListener('change', () =>
      patchSettings({ countryCode: refs.countryCode.value.replace(/[^\d]/g, '').slice(0, 4) })
    );
    refs.maxRows.addEventListener('change', () => patchSettings({ maxRows: numeric(refs.maxRows.value, 5000) }));
    refs.maxSeconds.addEventListener('change', () =>
      patchSettings({ maxSeconds: numeric(refs.maxSeconds.value, 240) })
    );
    refs.requirePhone.addEventListener('change', () => patchSettings({ requirePhone: refs.requirePhone.checked }));
    refs.includeRaw.addEventListener('change', () => patchSettings({ includeRaw: refs.includeRaw.checked }));

    refs.clearSiteBtn.addEventListener('click', async () => {
      if (!state.site) return;
      if (!confirm(t('confirmClear'))) return;
      await CE.store.clearSite(state.site.id);
      await CE.store.setLive(state.site.id, { status: 'idle', count: 0 });
      await refresh();
      clearMessages();
      render();
    });

    refs.clearAllBtn.addEventListener('click', async () => {
      if (!confirm(t('confirmClear'))) return;
      await CE.store.clearAll();
      state.filterSite = null;
      state.search = '';
      refs.search.value = '';
      await refresh();
      clearMessages();
      render();
    });
  }

  // ── boot ─────────────────────────────────────────────────
  async function detectTab() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      state.tab = tabs && tabs[0] ? tabs[0] : null;
    } catch {
      state.tab = null;
    }
    state.site = state.tab && state.tab.url ? CE.adapters.byUrl(state.tab.url) : null;
  }

  async function boot() {
    cacheRefs();
    state.settings = await CE.store.getSettings();
    state.lang = state.settings.lang || 'en';
    state.results = (await CE.store.getResults()) || {};
    state.live = (await CE.store.getLive()) || {};

    bindEvents();
    await detectTab();
    applyLang();
    render();

    CE.store.onChange((updates) => {
      let dirty = false;
      if (updates[CE.store.KEYS.results] !== undefined) {
        state.results = updates[CE.store.KEYS.results] || {};
        dirty = true;
      }
      if (updates[CE.store.KEYS.live] !== undefined) {
        state.live = updates[CE.store.KEYS.live] || {};
        const live = state.site ? state.live[state.site.id] : null;
        if (live && live.status === 'scanning' && !updates[CE.store.KEYS.results]) {
          // progress tick only — don't rebuild the whole list mid-scan
          refs.live.hidden = false;
          renderLive(live);
          return;
        }
        dirty = true;
      }
      if (updates[CE.store.KEYS.settings] !== undefined) {
        const prevLang = state.lang;
        state.settings = { ...state.settings, ...(updates[CE.store.KEYS.settings] || {}) };
        state.lang = state.settings.lang || prevLang;
        if (prevLang !== state.lang) applyLang();
        dirty = true;
      }
      if (dirty) render();
    });

    state.timer = setInterval(() => {
      const live = state.site ? state.live?.[state.site.id] : null;
      if (live && live.status === 'scanning') renderLive(live);
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();

// ─────────────────────────────────────────────────────────────
// background.js — MV3 service worker (classic script, no bundler)
//
// Does very little on purpose: seeds defaults on install and keeps the
// toolbar badge in sync with the number of stored contacts.
// ─────────────────────────────────────────────────────────────
importScripts('src/lib/util.js', 'src/lib/extract.js', 'src/lib/adapters.js', 'src/lib/store.js');

async function updateBadge() {
  if (!chrome.action || !chrome.action.setBadgeText) return;
  try {
    const results = await CE.store.getResults();
    const settings = await CE.store.getSettings();
    const contacts = [];
    for (const [siteId, entry] of Object.entries(results || {})) {
      for (const c of entry?.contacts || []) {
        contacts.push({ ...c, sites: c.sites && c.sites.length ? c.sites : [c.site || siteId] });
      }
    }
    const total = CE.extract.mergeAcrossSites(contacts, settings).length;
    chrome.action.setBadgeText({ text: total ? String(total) : '' });
    if (chrome.action.setBadgeBackgroundColor) {
      chrome.action.setBadgeBackgroundColor({ color: '#22d3ee' });
    }
    if (chrome.action.setBadgeTextColor) {
      chrome.action.setBadgeTextColor({ color: '#04121a' });
    }
  } catch {
    /* badge is cosmetic — never let it break anything */
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const settings = await CE.store.getSettings();
  await CE.store.setSettings(settings);
  updateBadge();
});

chrome.runtime.onStartup?.addListener(updateBadge);

if (chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[CE.store.KEYS.results] || changes[CE.store.KEYS.settings]) updateBadge();
  });
}

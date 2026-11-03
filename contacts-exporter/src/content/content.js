// ─────────────────────────────────────────────────────────────
// src/content/content.js — message bridge inside the web app
//
// The popup asks for a scan and can close immediately: the work keeps
// running here and every progress tick is written to chrome.storage,
// so reopening the popup shows the live count again.
// ─────────────────────────────────────────────────────────────
(() => {
  const CE = (globalThis.CE = globalThis.CE || {});
  if (!CE.engine || !CE.store) return;
  if (CE.__contentReady) return;
  CE.__contentReady = true;

  const site = CE.adapters.byHost(location.hostname);
  let running = false;

  // ── small in-page HUD (the popup closes as soon as you click the page) ──
  function createHud() {
    const box = document.createElement('div');
    box.setAttribute('data-ce-ui', '1');
    box.style.cssText = [
      'position:fixed',
      'right:18px',
      'bottom:18px',
      'z-index:2147483646',
      'pointer-events:none',
      'display:flex',
      'align-items:center',
      'gap:9px',
      'padding:10px 14px',
      'border-radius:999px',
      'background:rgba(11,18,32,.94)',
      'color:#e8eefb',
      'border:1px solid rgba(34,211,238,.45)',
      'box-shadow:0 14px 40px rgba(0,0,0,.45)',
      'font:12.5px/1.3 system-ui,-apple-system,Segoe UI,Tahoma,sans-serif',
      'direction:ltr',
      'backdrop-filter:blur(6px)',
    ].join(';');
    const dot = document.createElement('span');
    dot.style.cssText =
      'width:8px;height:8px;border-radius:50%;background:#22d3ee;box-shadow:0 0 10px #22d3ee;flex:0 0 auto';
    const label = document.createElement('span');
    label.textContent = 'Scanning…';
    box.append(dot, label);
    document.documentElement.appendChild(box);

    let removed = false;
    const remove = () => {
      if (removed) return;
      removed = true;
      box.remove();
    };

    return {
      update(count, elapsed) {
        label.textContent = `Scanning… ${count} found · ${Math.round(elapsed / 1000)}s`;
      },
      done(text) {
        label.textContent = text;
        dot.style.background = '#34d399';
        dot.style.boxShadow = '0 0 10px #34d399';
        setTimeout(remove, 5000);
      },
      fail(text) {
        label.textContent = text;
        dot.style.background = '#f87171';
        dot.style.boxShadow = '0 0 10px #f87171';
        setTimeout(remove, 7000);
      },
      remove,
    };
  }

  async function startScan(options = {}) {
    if (running) return { ok: false, error: 'BUSY', message: 'A scan is already running on this tab.' };
    running = true;

    const siteId = site?.id || options.siteId || 'custom';
    const settings = await CE.store.getSettings();
    const learned = await CE.store.getLearned();
    const learnedForHost = learned[location.hostname] ? [learned[location.hostname]] : [];

    await CE.store.setLive(siteId, {
      status: 'scanning',
      count: 0,
      rounds: 0,
      elapsed: 0,
      selector: options.selector || '',
      startedAt: Date.now(),
      message: '',
      host: location.hostname,
    });

    const hud = createHud();
    const reportProgress = CE.util.throttle((p) => {
      try {
        hud.update(p.count || 0, p.elapsed || 0);
      } catch {
        /* detached */
      }
      CE.store.setLive(siteId, {
        status: 'scanning',
        count: p.count,
        rounds: p.rounds,
        elapsed: p.elapsed,
        selector: p.selector,
        host: location.hostname,
      });
    }, 350);

    try {
      const result = await CE.engine.scan({
        siteId,
        selector: options.selector || '',
        learned: learnedForHost,
        settings,
        onProgress: reportProgress,
      });

      const entry = await CE.store.mergeSiteResults(siteId, {
        contacts: result.contacts,
        selector: result.selector,
        host: location.hostname,
        url: location.href,
        adapter: siteId,
        updatedAt: Date.now(),
      });

      if (options.selector && options.selector !== learned[location.hostname]) {
        await CE.store.set(CE.store.KEYS.learned, {
          ...learned,
          [location.hostname]: options.selector,
        });
      }

      await CE.store.setLive(siteId, {
        status: 'done',
        count: entry.contacts.length,
        found: result.contacts.length,
        selector: result.selector,
        elapsed: result.elapsed,
        rounds: result.rounds,
        finishedAt: Date.now(),
        host: location.hostname,
      });

      try {
        hud.done(`Done — ${entry.contacts.length} contacts saved`);
      } catch {
        /* noop */
      }

      return {
        ok: true,
        siteId,
        count: entry.contacts.length,
        found: result.contacts.length,
        selector: result.selector,
        elapsed: result.elapsed,
      };
    } catch (error) {
      const code = error.code || 'ERROR';
      try {
        hud.fail(code === 'NO_ROWS' ? 'No contact rows found — try “Teach me”' : `Scan failed: ${code}`);
      } catch {
        /* noop */
      }
      await CE.store.setLive(siteId, {
        status: 'error',
        error: code,
        message: error.message || String(error),
        host: location.hostname,
      });
      return { ok: false, error: code, message: error.message || String(error) };
    } finally {
      running = false;
    }
  }

  async function learnSelector(selector) {
    if (!selector) return;
    const learned = await CE.store.getLearned();
    await CE.store.set(CE.store.KEYS.learned, { ...learned, [location.hostname]: selector });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) return undefined;
    // A stale content script (extension updated/reloaded) has no valid context.
    if (!chrome.runtime?.id) return undefined;

    switch (message.type) {
      case 'CE_PING':
        sendResponse({ ok: true, site: site?.id || null, href: location.href });
        return undefined;

      case 'CE_SCAN':
        startScan(message.options || {})
          .then(sendResponse)
          .catch((error) => {
            try {
              sendResponse({ ok: false, error: 'ERROR', message: error?.message || String(error) });
            } catch {
              /* popup already closed */
            }
          });
        return true;

      case 'CE_PICK':
        CE.engine
          .pickSelector(message.lang || 'en')
          .then(async (picked) => {
            if (!picked) return sendResponse({ ok: false, cancelled: true });
            await learnSelector(picked.selector);
            // The popup closes the moment the user clicks the page, so we start
            // the scan here instead of waiting for another popup message.
            const result = await startScan({ selector: picked.selector });
            sendResponse({ ok: true, ...picked, scan: result });
          })
          .catch((error) => sendResponse({ ok: false, message: error.message }));
        return true;

      case 'CE_DIAGNOSE':
        try {
          sendResponse({ ok: true, candidates: CE.engine.diagnose(), site: site?.id || null });
        } catch (error) {
          sendResponse({ ok: false, message: error.message });
        }
        return undefined;

      case 'CE_LEARN':
        learnSelector(message.selector).then(() => sendResponse({ ok: true }));
        return true;

      default:
        return undefined;
    }
  });
})();

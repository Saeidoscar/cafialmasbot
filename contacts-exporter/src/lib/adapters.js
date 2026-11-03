// ─────────────────────────────────────────────────────────────
// src/lib/adapters.js — per-site knowledge
//
// Each adapter is only a *hint*: a list of likely row selectors, an
// optional explicit scroll container and a human hint about which
// panel to open before scanning. When a web app changes its markup,
// the "Teach me" picker + "Diagnose" panel take over, and the learned
// selector is stored per host.
// ─────────────────────────────────────────────────────────────
(() => {
  const CE = (globalThis.CE = globalThis.CE || {});
  if (CE.adapters) return;

  const sites = {
    telegram: {
      id: 'telegram',
      label: 'Telegram',
      labelFa: 'تلگرام',
      color: '#2aabee',
      openUrl: 'https://web.telegram.org/k/',
      rollup: [/(^|\.)web\.telegram\.org$/i, /(^|\.)telegram\.org$/i],
      selectors: [
        '.chatlist .chatlist-chat',
        '#chats-container .chatlist-chat',
        '.chatlist-chat',
        '.chatlist .row',
        '.contacts-container .row',
        '[data-peer-id]',
        '.peer-item',
      ],
      scrollSelectors: ['#column-left .scrollable', '.chatlist-parts .scrollable', '#chats-container'],
      nameSelector: '.peer-title, .dialog-title, .user-title',
      usernameSelector: '.peer-subtitle, .dialog-subtitle',
      hint: {
        en: 'Telegram Web → open the Contacts panel (☰ → Contacts) or the chat list, scroll once, then Scan.',
        fa: 'وب تلگرام → پنل مخاطبین (☰ → Contacts) یا لیست چت‌ها را باز کنید، یک‌بار اسکرول کنید و بعد اسکن بزنید.',
      },
      phoneNote: 'Phone numbers appear only for contacts who shared them (usually visible in the contact profile).',
    },
    whatsapp: {
      id: 'whatsapp',
      label: 'WhatsApp',
      labelFa: 'واتس‌اپ',
      color: '#25d366',
      openUrl: 'https://web.whatsapp.com/',
      rollup: [/(^|\.)web\.whatsapp\.com$/i],
      selectors: [
        '#pane-side [role="listitem"]',
        '#pane-side [data-testid="cell-frame-container"]',
        '#pane-side div[role="row"]',
        '[aria-label="Chat list"] [role="listitem"]',
        '[data-testid="cell-frame-container"]',
        'div[role="listitem"]',
      ],
      scrollSelectors: ['#pane-side', '#side'],
      nameSelector: 'span[title], [data-testid="cell-frame-title"] span',
      hint: {
        en: 'WhatsApp Web → click the “New chat” pencil, open the Contacts tab, then Scan (the list is long: let it scroll).',
        fa: 'واتس‌اپ وب → روی آیکن «چت جدید» بزنید، تب Contacts را باز کنید و اسکن کنید (لیست بلند است، بگذارید اسکرول شود).',
      },
      phoneNote: 'WhatsApp only knows numbers that have a WhatsApp account — the web client has no access to your phone book.',
    },
    rubika: {
      id: 'rubika',
      label: 'Rubika',
      labelFa: 'روبیکا',
      color: '#7b5cff',
      openUrl: 'https://web.rubika.ir/',
      rollup: [/(^|\.)web\.rubika\.ir$/i, /(^|\.)rubika\.ir$/i],
      selectors: [
        '.chat-list .chat-item',
        '.chatlist-chat',
        '.chat-item',
        '.chat-list-item',
        '.contact-item',
        '.user-item',
        '.chat-row',
        '[class*="chat-item"]',
        '[class*="contact-item"]',
      ],
      scrollSelectors: ['.chat-list', '.chats-list', '.sidebar', '.contacts-list'],
      nameSelector: '[class*="title"], [class*="name"]',
      hint: {
        en: 'Rubika Web → open Chats or Contacts, scroll once so the list renders, then Scan. If nothing is found, use “Teach me”.',
        fa: 'روبیکا وب → چت‌ها یا مخاطبین را باز کنید، یک‌بار اسکرول کنید و اسکن بزنید. اگر چیزی پیدا نشد از «آموزش» استفاده کنید.',
      },
      phoneNote: 'Rubika hides numbers unless the contact shared them in their profile.',
    },
    eitaa: {
      id: 'eitaa',
      label: 'Eitaa',
      labelFa: 'ایتا',
      color: '#f59e0b',
      openUrl: 'https://web.eitaa.com/',
      rollup: [/(^|\.)web\.eitaa\.com$/i, /(^|\.)eitaa\.com$/i],
      selectors: [
        '.chat-list .chat-item',
        '.chatlist-chat',
        '.chat-item',
        '.chat-list-item',
        '.contact-item',
        '.user-item',
        '.chat-row',
        '.dialog-item',
        '[class*="chat-item"]',
        '[class*="contact-item"]',
      ],
      scrollSelectors: ['.chat-list', '.chats-list', '.sidebar', '.contacts-list'],
      nameSelector: '[class*="title"], [class*="name"]',
      hint: {
        en: 'Eitaa Web → open Chats or Contacts, scroll once, then Scan. If nothing is found, use “Teach me”.',
        fa: 'ایتا وب → چت‌ها یا مخاطبین را باز کنید، یک‌بار اسکرول کنید و اسکن بزنید. اگر چیزی پیدا نشد از «آموزش» استفاده کنید.',
      },
      phoneNote: 'Eitaa hides numbers unless the contact shared them in their profile.',
    },
  };

  const order = ['telegram', 'whatsapp', 'rubika', 'eitaa'];

  function byHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    for (const id of order) {
      if (sites[id].rollup.some((re) => re.test(host))) return sites[id];
    }
    return null;
  }

  function byUrl(url) {
    try {
      return byHost(new URL(url).hostname);
    } catch {
      return null;
    }
  }

  CE.adapters = { sites, order, byHost, byUrl, list: () => order.map((id) => sites[id]) };
})();

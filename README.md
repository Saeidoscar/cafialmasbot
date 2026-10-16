# Smart Internet Cafe — Serverless Telegram Bot + Local Playwright Agent

<div align="right">

![PHP](https://img.shields.io/badge/PHP-8.2%2B-777BB4?style=flat-square)
![Node](https://img.shields.io/badge/Node.js-18%2B-339933?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)
![Status](https://img.shields.io/badge/Status-Active-success?style=flat-square)

</div>

A production-ready, decoupled system for automating **Iranian government portal registrations** from an Internet Cafe. Users interact via Telegram bot commands; a local Windows/VPS agent uses Playwright to fill forms and handle CAPTCHAs.

```
┌─────────────────────────────────────┐
│  Telegram User                      │
│  sends /sana or /gica               │
└────────────────┬────────────────────┘
                 │ Telegram Bot API
                 ▼
┌─────────────────────────────────────┐       ┌────────────────────────┐
│  tgcloud (serverless)               │ HTTP  │  Local VPS / Windows   │
│  index.js → handlers/message.js     │◄─────►│  local_agent/scraper.js│
│  lib/ai.js (GPT slot-filling)       │  API  │  Playwright Chromium   │
│  SQLite DB (schema.js)              │       │  (headed, for CAPTCHA) │
└─────────────────────────────────────┘       └────────────────────────┘
```

## Related tooling in this repository

### `bulksms/` — PayamResan bulk-SMS toolkit (Android APK + Windows EXE)

A separate, self-contained toolkit for personal bulk SMS through your own SIM card:
an Android app (Kotlin) that reads a contact CSV and sends via `SmsManager` under a daily
cap, and a Windows desktop app (PySide6 → single EXE) that validates the same CSV, builds
the message template and drives the phone over a token-protected LAN bridge.

Both artifacts are built by the [Build PayamResan workflow](.github/workflows/build-payamresan.yml)
and published as run artifacts (`payamresan-android-apk`, `payamresan-windows-exe`).

- Manual (فارسی): [`bulksms/README.md`](bulksms/README.md)
- CSV contract & column rules: [`bulksms/docs/CSV_RULES.md`](bulksms/docs/CSV_RULES.md)
- Install & troubleshoot: [`bulksms/docs/INSTALL.md`](bulksms/docs/INSTALL.md)
- Operator limits & legality: [`bulksms/docs/LIMITS_AND_LAW.md`](bulksms/docs/LIMITS_AND_LAW.md)
- Ready-made prompt for AI agents that generate CSVs: [`bulksms/docs/AGENT_PROMPT.md`](bulksms/docs/AGENT_PROMPT.md)

---

## Features

- **9 Government Services** — SANA, GICA, MYGOV, TAX, INSURANCE, MOJAVEZ, AMLAK, KHODNEWIS, SAMAN
- **AI-Powered Slot Filling** — GPT-4o-mini collects required fields via Persian conversation FSM
- **Local CAPTCHA Solving** — headed Chromium lets cafe operator solve CAPTCHAs manually
- **Dual Deployment** — Cloudflare Workers (`src/`) + Render Express (`server.js`)
- **PHP Admin Dashboard** — modern RTL Persian interface with stats, job management, and service workflows
- **Security Hardened** — `.gitignore`, rate limiting, input validation, security headers, CSRF protection, session auth
- **Extensible** — add new services by defining fields in `lib/ai.js` and a scraper function in `local_agent/scraper.js`

## Quick Start

### Prerequisites
- Node.js ≥ 18
- PHP 8.2+ (for dashboard)
- Telegram Bot token from [@BotFather](https://t.me/BotFather)
- OpenAI-compatible API key (e.g. ArvanCloud GPT-5-Nano)

### 1. Clone & Install

```bash
git clone https://github.com/YOUR_USERNAME/smart-cafe-serverless.git
cd smart-cafe-serverless

# Root dependencies (Express server for Render)
npm install

# Local agent dependencies
cd local_agent
npm install
npx playwright install chromium
cd ..
```

### 2. Configure Secrets

Copy `.env.example` to `.env` and fill in:

```bash
cp .env.example .env
```

| Variable | Description |
|----------|-------------|
| `BOT_TOKEN` | Telegram bot token |
| `APP_URL` | Full URL of your deployed bot |
| `OPENAI_API_KEY` | OpenAI-compatible API key |
| `OPENAI_BASE_URL` | API gateway URL |
| `OPENAI_MODEL` | Model name (e.g. `gpt-4o-mini`) |
| `AGENT_API_KEY` | Shared secret for local agent (generate with `openssl rand -hex 32`) |

### 3. Run Locally

```bash
# Start Express server (port 3000)
npm start

# In another terminal, start local agent
cd local_agent
node scraper.js
```

### 4. Open Dashboard

```bash
# If XAMPP is installed, files are already in htdocs
# Otherwise, serve dashboard/ with any PHP server
cd dashboard
php -S localhost:8080
```

Visit `http://localhost/dashboard/` and login with `AGENT_API_KEY`.

## Architecture

```
smart-cafe-serverless/
├── .env.example                ← Placeholder secrets
├── .gitignore                  ← Prevents secret leaks
├── SECURITY.md                 ← Security standards
├── AGENTS.md                   ← AI assistant conventions
├── README.md                   ← This file
├── package.json                ← Express server dependencies
├── server.js                   ← Render.com Express server
├── wrangler.toml               ← Cloudflare Workers config
├── schema.js / schema.sql      ← Database schema
├── src/
│   ├── index.js                ← Cloudflare Workers entry
│   ├── handlers/
│   │   ├── message.js          ← Telegram message handler
│   │   └── callback_query.js   ← Inline button handler
│   └── lib/
│       ├── db.js               ← SQLite wrapper
│       ├── telegram.js         ← Telegram API client
│       └── ai.js               ← AI slot-filling logic
├── handlers/                   ← tgcloud SDK handlers
├── lib/
│   ├── ai.js                   ← AI field definitions
│   ├── dashboard.js            ← Dashboard HTML builder
│   └── security.js             ← Validation utilities
├── local_agent/
│   ├── .env                    ← Local secrets (gitignored)
│   ├── package.json            ← Agent deps
│   └── scraper.js              ← Playwright automation
└── dashboard/                  ← PHP admin dashboard
    ├── index.php
    ├── api.php
    ├── config.php
    ├── auth.php
    ├── login.php
    └── assets/
        ├── css/style.css
        └── js/app.js
```

## Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message |
| `/help` | Detailed help |
| `/sana` | SANA registration |
| `/gica` | GICA registration |
| `/mygov` | my.gov.ir login |
| `/tax` | my.tax.gov.ir tax tasks |
| `/insurance` | eservice.tamin.ir insurance |
| `/mojavez` | mojavez.ir business license |
| `/amlak` | amlak.mrud.ir property inquiry |
| `/khodnevis` | khodnevis.mrud.ir contracts |
| `/saman` | saman.mrud.ir loans |
| `/add_doc [name] [value]` | Save credential |
| `/my_docs` | View saved credentials |
| `/link_chat [chat_id]` | Link group/channel |
| `/cancel` | Cancel current session |

## Roadmap

### Phase 1 — Core Bot & AI (Completed)
- [x] Telegram bot with command routing
- [x] AI slot-filling FSM for SANA/GICA
- [x] Local Playwright agent with CAPTCHA handling
- [x] SQLite database with jobs queue
- [x] Basic Express dashboard

### Phase 2 — Service Expansion (Completed)
- [x] 9 government services integrated
- [x] Service tree navigation in dashboard
- [x] Per-service workflow forms
- [x] AI field definitions for all services
- [x] Scraper automation for all portals

### Phase 3 — Security & Polish (Completed)
- [x] `.gitignore` and secret sanitization
- [x] Rate limiting and security headers
- [x] Input validation and sanitization
- [x] PHP dashboard with auth, CSRF, sessions
- [x] Light/dark mode toggle
- [x] RTL Persian interface
- [x] Interactive demo page

### Phase 4 — Production Readiness (Planned)
- [ ] Docker compose for one-command deployment
- [ ] PostgreSQL migration option (from SQLite)
- [ ] Webhook secret verification for Telegram
- [ ] Multi-operator support (concurrent CAPTCHA solving)
- [ ] PDF/Excel export for job reports
- [ ] Telegram bot analytics and usage stats
- [ ] CI/CD pipeline with GitHub Actions
- [ ] Automated portal selector updater

### Phase 5 — Scaling (Future)
- [ ] Queue system with Redis/RabbitMQ
- [ ] Multiple cafe branches support
- [ ] Role-based access control (RBAC)
- [ ] API versioning and OpenAPI docs
- [ ] Mobile app for operators (React Native)
- [ ] ML-based CAPTCHA solving integration

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

### Development Guidelines
- Follow the conventions in `AGENTS.md`
- All secrets must stay in `.env` (never commit them)
- Run `node --check` on JS files before committing
- Test new services locally with `demo.html`

## Security

See [SECURITY.md](SECURITY.md) for full security standards.

**Key principles:**
- Never commit secrets or API keys
- All API endpoints require authentication
- Input validation on all user data
- Rate limiting on public endpoints
- Security headers on all responses

## License

MIT © Smart Cafe Team

# Smart Internet Cafe (کافه اینترنت الماس) — Serverless Dual-Bot Ecosystem + n8n Workflows + Playwright Agent

<div align="right">

![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-D1_Serverless-F38020?style=flat-square)
![Node](https://img.shields.io/badge/Node.js-18%2B%20%2F%2022-339933?style=flat-square)
![n8n](https://img.shields.io/badge/n8n-Workflows_Included-EA4B71?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)

</div>

A complete, serverless **Two-Bot Telegram Ecosystem** for automating and managing **9 Iranian government & internet cafe services** (`SANA`, `GICA`, `MYGOV`, `TAX`, `INSURANCE`, `MOJAVEZ`, `AMLAK`, `KHODNEWIS`, `SAMAN`):

1. **👤 Service-End Bot (Customer Bot — `/webhook` or `/webhook/service`)**:
   - Customers browse all **9 services** by category (`/services`) or launch directly (`/sana`, `/gica`, `/mygov`, `/tax`, `/insurance`, `/mojavez`, `/amlak`, `/khodnevis`, `/saman`).
   - Customers can either enter the **⚡ Instant Queue** OR **🕒 Book a Manager's Time Slot** (`/slots`).
   - **Hybrid AI + Deterministic Slot-Filling FSM** (`src/lib/ai.js`) pre-fills saved credentials from the customer's document vault (`/my_docs`) and validates inputs (with automatic Persian digit normalization `۰-۹ → 0-9`).
   - Customers receive **real-time results & tracking codes**, rate the manager **1–5 ⭐**, and open **two-way support tickets** (`/support`).

2. **👨‍💼 Manager-End Bot (Provider / Operator Bot — `/webhook/manager` or `/manager`)**:
   - Managers register (`/register_manager`), toggle **🟢 Online / 🔴 Offline** availability, and choose which of the **9 services** they provide.
   - Managers **set their working hours and available appointment time slots** (`/set_time` or 1-tap shift buttons).
   - Managers view & claim pending jobs (`MGR_CLAIM`), request OTP/clarifications from the customer (`MGR_ASK_PROMPT`), and deliver final results (`/complete`) directly to the customer on the Service Bot.
   - Managers reply to customer support tickets (`MGR_TICKETS`) and track their ratings and completed job statistics.

3. **🔗 n8n JSON Workflows (`n8n/`) & Local Playwright Agent (`local_agent/`)**:
   - Includes 3 ready-to-import n8n workflows (`n8n/service-customer-bot.workflow.json`, `n8n/manager-provider-bot.workflow.json`, `n8n/support-ticket-relay.workflow.json`) connected to `POST /api/n8n/webhook`.
   - Includes headed Playwright automation (`local_agent/scraper.js`) for automatic portal form-filling with manual CAPTCHA solving.

---

## Architecture Overview

See [ARCHITECTURE.md](ARCHITECTURE.md) for the reverse-engineering breakdown of [`freezerain/telegram-bot`](https://github.com/freezerain/telegram-bot), [`morluto/rea`](https://github.com/morluto/rea), and top Telegram booking & support bots.

```
Customer (@ServiceBot) ──► POST /webhook/service ──┐
                                                   ├──► Serverless Core (Workers D1 / Express SQLite)
Manager  (@ManagerBot) ──► POST /webhook/manager ──┤    • 9 Services Catalog (src/lib/services.js)
                                                   │    • Hybrid AI + Regex Slot-Filling (src/lib/ai.js)
n8n Workflows (n8n/*.json) ► POST /api/n8n/webhook ┘    • Time Slots, Jobs & Support Tickets
```

---

## 9 Supported Services

| Code | Command | Portal | Category | Required Fields |
|------|---------|--------|----------|-----------------|
| `SANA` | `/sana` | `sana.ir` | ⚖️ Judicial & Identity | `national_id`, `birth_date`, `mobile_number`, `serial_number` |
| `GICA` | `/gica` | `gica.ir` | ⚖️ Judicial & Identity | `national_id`, `birth_date`, `mobile_number`, `tracking_code` |
| `MYGOV` | `/mygov` | `my.gov.ir` | 🏛 e-Gov & Tax | `phone_number`, `national_id`, `birth_date`, `birth_place` |
| `TAX` | `/tax` | `my.tax.gov.ir` | 🏛 e-Gov & Tax | `national_id`, `birth_date`, `mygov_token`, `tax_id` |
| `INSURANCE` | `/insurance` | `eservice.tamin.ir` | 🏥 Insurance & Business | `national_id`, `birth_date`, `insurance_number`, `insurance_type` |
| `MOJAVEZ` | `/mojavez` | `mojavez.ir` | 🏥 Insurance & Business | `national_id`, `birth_date`, `business_type`, `business_address` |
| `AMLAK` | `/amlak` | `amlak.mrud.ir` | 🏠 Housing & Banking | `national_id`, `birth_date`, `address`, `post_code` |
| `KHODNEWIS` | `/khodnevis` | `khodnevis.mrud.ir` | 🏠 Housing & Banking | `national_id`, `birth_date`, `contract_type` |
| `SAMAN` | `/saman` | `saman.mrud.ir` | 🏠 Housing & Banking | `national_id`, `birth_date`, `loan_amount`, `loan_type` |

---

## Bot Commands Reference

### 👤 Service-End Bot (Customer Commands)
| Command | Description |
|---------|-------------|
| `/start` | Welcome menu with interactive Service Catalog, Slot Booking, Results & Support |
| `/services` | Browse all 9 services by category, fees, and required documents |
| `/slots` | View open manager appointment time slots and book a slot |
| `/my_jobs` | View submitted requests, assigned manager, and delivered results |
| `/support [msg]` | Open a two-way support ticket with a manager |
| `/sana`, `/gica`, `/mygov`, `/tax`, `/insurance`, `/mojavez`, `/amlak`, `/khodnevis`, `/saman` | Start any of the 9 service workflows directly |
| `/add_doc [key] [val]` | Save reusable credential in personal vault |
| `/my_docs` | View saved credentials |
| `/cancel` | Cancel current active flow |

### 👨‍💼 Manager-End Bot (Provider / Manager Commands)
| Command | Description |
|---------|-------------|
| `/manager` or `/panel` | Open the Manager Control Panel (status, queue, slots, services, tickets, stats) |
| `/register_manager [code]` | Register as a service manager/provider |
| `/set_time [date] [start] [end] [cap]` | Add an available time slot (e.g. `/set_time 1405/07/26 09:00 11:00 2`) |
| `/working_hours [start] [end]` | Update daily working hours (e.g. `/working_hours 08:00 20:00`) |
| `/complete [job_id] [result]` | Complete a job and send the result & rating prompt to the customer |
| `/fail [job_id] [reason]` | Mark a job as failed with reason and notify customer |

---

## Quick Start

```bash
# Run test suite (48 unit & end-to-end dual-bot tests)
npm test

# Start server (Express + Interactive Dual-Bot Simulator at /demo & Dashboard at /dashboard)
npm start
```

### Cloudflare Workers Serverless Deployment
```bash
npx wrangler d1 execute smart-cafe-db --file=schema.sql
npx wrangler deploy
```

# Cafialmas Serverless Dual-Bot Architecture & Reverse-Engineering Blueprint

## 1. GitHub Repositories Analyzed & Reverse-Engineered

To build a production-grade **Serverless Multi-Service Telegram Ecosystem** with a **Service-End Bot (Customer)** and a **Manager-End Bot (Provider/Operator)**, we analyzed and combined the strongest architectural patterns from public open-source repositories:

| Repository | Key Patterns Reverse-Engineered & Adopted |
|---|---|
| **[`freezerain/telegram-bot`](https://github.com/freezerain/telegram-bot)** | • **Cloudflare Workers + D1 Serverless Runtime**: Dual `fetch` (webhook + REST API) and `scheduled` (cron timer) entry points in `src/index.js`.<br>• **Action Map & Router Pattern**: Clean separation of Telegram API wrappers (`src/lib/telegram.js`), database repositories (`src/db/repository.js`), and modular command/callback routing. |
| **[`morluto/rea`](https://github.com/morluto/rea)** | • **Lifecycle & Ownership Guarantees**: Atomic job claiming (`PENDING → PROCESSING` with HTTP 409 race protection), structured result retention (`result_data`), and deterministic fallback when external AI providers fail. |
| **[`Mastn1kth/telegram-business-booking-bot`](https://github.com/Mastn1kth/telegram-business-booking-bot)** & **[`yusizer/telegram-booking-bot`](https://github.com/yusizer/telegram-booking-bot)** | • **Service → Manager → Time-Slot Booking Flow**: Providers (`managers`) define services offered and open `time_slots` (`slot_date`, `start_time`, `end_time`, `capacity`); customers either book a specific slot or enter the fast queue, and rate completed jobs (1–5 ⭐). |
| **[`Automations-Project/n8n-advanced-telegram-support-ticket-management-workflow`](https://github.com/Automations-Project/n8n-advanced-telegram-support-ticket-management-workflow)** & **[`17sho/telegram-support-relay-bot`](https://github.com/17sho/telegram-support-relay-bot)** | • **Two-Way Customer ↔ Manager Support Ticket Relay**: Customers open support tickets (general or bound to a specific job `#id`); messages relay between the Service Bot and Manager Bot without exposing personal accounts, with ready-to-import **n8n JSON workflows** in `n8n/`. |

---

## 2. Dual-Bot Ecosystem Design

```
┌───────────────────────────────────────────────────────────────────────────┐
│                         CUSTOMER (Service-End Bot)                        │
│  • Browse 9 Services by Category (/services) or direct commands (/sana…)  │
│  • Choose Instant Queue OR Book a Manager's Time Slot (/slots)            │
│  • Hybrid AI + Deterministic Slot-Filling with Document Vault (/my_docs)  │
│  • Receive Real-Time Results, Tracking Codes, 1–5⭐ Rating & /support      │
└───────────────────────────────┬───────────────────────────────────────────┘
                                │ Webhook: POST /webhook (or /webhook/service)
                                ▼
┌───────────────────────────────────────────────────────────────────────────┐
│        SERVERLESS CORE (Cloudflare Workers D1 / Express SQLite)           │
│  • Unified DB Adapter (src/lib/db.js) — works on D1 & node:sqlite         │
│  • Repositories: Users, Managers, TimeSlots, ScrapingJobs, SupportTickets │
│  • n8n Automation Bridge: POST /api/n8n/webhook                           │
│  • Playwright Local Agent API: GET /api/jobs, POST /api/jobs/:id/claim    │
└───────────────────────────────┬───────────────────────────────────────────┘
                                │ Webhook: POST /webhook/manager
                                ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                     MANAGER / PROVIDER (Manager-End Bot)                  │
│  • Toggle Online/Offline Status & Select Offered Services (1..9)          │
│  • Set Working Hours & Create Appointment Time Slots (/set_time, Quick)   │
│  • Claim Pending Customer Jobs, Request OTP/Clarification from Customer   │
│  • Submit Final Result / Tracking Code → Instant Delivery to Customer     │
│  • Reply to Customer Support Tickets & Track Performance/Ratings          │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Complete Catalog of 9 Supported Services (`src/lib/services.js`)

| Code | Command | Portal | Category | Required Fields |
|---|---|---|---|---|
| `SANA` | `/sana` | `sana.ir` | ⚖️ Judicial & Identity | `national_id`, `birth_date`, `mobile_number`, `serial_number` |
| `GICA` | `/gica` | `gica.ir` | ⚖️ Judicial & Identity | `national_id`, `birth_date`, `mobile_number`, `tracking_code` |
| `MYGOV` | `/mygov` | `my.gov.ir` | 🏛 e-Gov & Tax | `phone_number`, `national_id`, `birth_date`, `birth_place` |
| `TAX` | `/tax` | `my.tax.gov.ir` | 🏛 e-Gov & Tax | `national_id`, `birth_date`, `mygov_token`, `tax_id` |
| `INSURANCE` | `/insurance` | `eservice.tamin.ir` | 🏥 Insurance & Business | `national_id`, `birth_date`, `insurance_number`, `insurance_type` |
| `MOJAVEZ` | `/mojavez` | `mojavez.ir` | 🏥 Insurance & Business | `national_id`, `birth_date`, `business_type`, `business_address` |
| `AMLAK` | `/amlak` | `amlak.mrud.ir` | 🏠 Housing & Banking | `national_id`, `birth_date`, `address`, `post_code` |
| `KHODNEWIS` | `/khodnevis` | `khodnevis.mrud.ir` | 🏠 Housing & Banking | `national_id`, `birth_date`, `contract_type` |
| `SAMAN` | `/saman` | `saman.mrud.ir` | 🏠 Housing & Banking | `national_id`, `birth_date`, `loan_amount`, `loan_type` |

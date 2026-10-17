# n8n Workflows for Cafialmas Dual-Bot Ecosystem

This directory contains ready-to-import **n8n JSON workflow templates** designed to work seamlessly with the Cafialmas Serverless Worker (`src/index.js`) and Express Server (`server.js`).

## Included Workflows

1. **`service-customer-bot.workflow.json`** — **Service-End Bot (Customer Bot)**
   - Connects to your Customer Telegram Bot (`BOT_TOKEN`).
   - Routes customer service selection across all **9 Iranian Government & Cafe Services** (`SANA`, `GICA`, `MYGOV`, `TAX`, `INSURANCE`, `MOJAVEZ`, `AMLAK`, `KHODNEWIS`, `SAMAN`).
   - Integrates with manager time-slot availability (`list_open_slots`) and forwards conversational slot-filling updates to `/webhook/service`.

2. **`manager-provider-bot.workflow.json`** — **Manager-End Bot (Service Provider Bot)**
   - Connects to your Manager Telegram Bot (`MANAGER_BOT_TOKEN`).
   - Handles manager registration, working hours & time-slot creation (`/set_time`), atomic job claiming, and result delivery to customers.
   - Includes a **15-minute Cron Schedule Trigger** that checks for unaddressed `PENDING` jobs and sends SLA reminders to active managers.

3. **`support-ticket-relay.workflow.json`** — **Two-Way Support Ticket Relay**
   - Reverse-engineered from `Automations-Project/n8n-advanced-telegram-support-ticket-management-workflow` and `17sho/telegram-support-relay-bot`.
   - Provides bidirectional ticket routing between customers on the Service Bot and managers on the Manager Bot via `/api/n8n/webhook`.

## How to Import into n8n

1. Open your n8n dashboard → **Workflows** → **Import from File**.
2. Select any of the `.workflow.json` files in this folder.
3. Set the environment variables in n8n (or edit the `Bot Config` node):
   - `CAFIALMAS_API_URL`: URL of your deployed Cloudflare Worker or Express server (e.g. `https://smart-cafe-bot.workers.dev` or `http://localhost:3000`).
   - `AGENT_API_KEY`: Your shared secret key.

## Direct n8n Webhook Actions (`POST /api/n8n/webhook`)

You can call `POST /api/n8n/webhook` with header `X-Api-Key: <AGENT_API_KEY>` and any of the following JSON bodies:

```json
// 1. Register a Manager & Services Offered
{
  "action": "register_manager",
  "manager_id": "9001001",
  "username": "ali_expert",
  "display_name": "مهندس علی رضایی",
  "services_offered": ["SANA", "GICA", "TAX", "MYGOV"]
}

// 2. Set Manager Available Time Slots
{
  "action": "set_manager_slots",
  "manager_id": "9001001",
  "slots": [
    { "slot_date": "1405/07/26", "start_time": "09:00", "end_time": "10:30", "capacity": 2 },
    { "slot_date": "1405/07/26", "start_time": "14:00", "end_time": "16:00", "capacity": 3 }
  ]
}

// 3. Complete a Customer Job & Deliver Result + Rating Prompt
{
  "action": "complete_job",
  "job_id": 1,
  "manager_id": "9001001",
  "result_text": "ثبت‌نام ثنا با موفقیت انجام شد. کد رهگیری: 981273645",
  "tracking_code": "981273645"
}
```

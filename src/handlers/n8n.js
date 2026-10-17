// ─────────────────────────────────────────────
// src/handlers/n8n.js — پل یکپارچه‌سازی دوطرفه با ورک‌فلوهای n8n
// ─────────────────────────────────────────────

import {
  UsersRepository,
  ManagersRepository,
  TimeSlotsRepository,
  ScrapingJobsRepository,
  SupportTicketsRepository,
} from '../db/repository.js';
import { SERVICES_CATALOG, SERVICE_CATEGORIES, TASK_NAME_FA } from '../lib/services.js';
import { notifyManagersOfNewJob } from './manager.js';

export async function handleN8nWebhook(body, db, customerApi, managerApi = null) {
  const mgrApi = managerApi ?? customerApi;
  const action = String(body?.action ?? '').trim();

  const usersRepo    = new UsersRepository(db);
  const managersRepo = new ManagersRepository(db);
  const slotsRepo    = new TimeSlotsRepository(db);
  const jobsRepo     = new ScrapingJobsRepository(db);
  const ticketsRepo  = new SupportTicketsRepository(db);

  switch (action) {
    case 'list_services': {
      return {
        ok: true,
        categories: Object.values(SERVICE_CATEGORIES),
        services: Object.values(SERVICES_CATALOG),
      };
    }

    case 'list_open_slots': {
      const serviceType = body.service_type ?? 'ALL';
      const slots = await slotsRepo.listOpenSlots(serviceType, Number(body.limit ?? 20));
      return { ok: true, slots };
    }

    case 'register_manager': {
      const { manager_id, username, display_name, services_offered } = body;
      if (!manager_id) return { ok: false, error: 'manager_id الزامی است.' };
      const manager = await managersRepo.upsert(
        String(manager_id),
        username ?? 'manager',
        display_name ?? 'کارشناس کافه',
        Array.isArray(services_offered) ? services_offered : undefined
      );
      await usersRepo.getOrCreate(String(manager_id), username ?? 'manager', display_name);
      await usersRepo.updateRole(String(manager_id), 'manager');
      return { ok: true, manager };
    }

    case 'set_manager_slots': {
      const { manager_id, slots = [] } = body;
      if (!manager_id || !Array.isArray(slots) || !slots.length) {
        return { ok: false, error: 'manager_id و آرایه slots الزامی است.' };
      }
      const created = [];
      for (const s of slots) {
        const slot = await slotsRepo.createSlot(
          String(manager_id),
          s.slot_date,
          s.start_time,
          s.end_time,
          s.service_type ?? 'ALL',
          s.capacity ?? 1
        );
        created.push(slot);
      }
      return { ok: true, created_count: created.length, slots: created };
    }

    case 'create_service_job': {
      const { user_id, username, task_type, payload = {}, slot_id = null, manager_id = null } = body;
      if (!user_id || !task_type) {
        return { ok: false, error: 'user_id و task_type الزامی است.' };
      }
      await usersRepo.getOrCreate(String(user_id), username ?? 'customer');
      let assignedMgr = manager_id ? String(manager_id) : null;
      if (slot_id && !assignedMgr) {
        const s = await slotsRepo.findById(Number(slot_id));
        if (s?.manager_id) assignedMgr = String(s.manager_id);
      }
      const job = await jobsRepo.create(
        String(user_id),
        String(task_type).toUpperCase(),
        payload,
        assignedMgr,
        slot_id ? Number(slot_id) : null
      );
      if (slot_id && job?.id) {
        await slotsRepo.reserveSlot(Number(slot_id), String(user_id), job.id);
      }
      if (job) {
        await notifyManagersOfNewJob(mgrApi, db, job, username ?? 'مشتری').catch(() => {});
      }
      return { ok: true, job };
    }

    case 'claim_job': {
      const { job_id, manager_id } = body;
      if (!job_id) return { ok: false, error: 'job_id الزامی است.' };
      const claimed = await jobsRepo.claim(Number(job_id), manager_id ? String(manager_id) : null);
      const job = await jobsRepo.findById(Number(job_id));
      if (claimed && job) {
        const taskNameFa = TASK_NAME_FA[job.task_type] ?? job.task_type;
        await customerApi
          .sendMessage({
            chat_id: job.user_id,
            text: `⚙️ درخواست ${taskNameFa} (#${job.id}) توسط کارشناس دریافت شد و در حال انجام است.`,
          })
          .catch(() => {});
      }
      return { ok: claimed, job };
    }

    case 'complete_job': {
      const { job_id, manager_id, result_text, tracking_code } = body;
      if (!job_id) return { ok: false, error: 'job_id الزامی است.' };
      const job = await jobsRepo.findById(Number(job_id));
      if (!job) return { ok: false, error: 'درخواست یافت نشد.' };

      const summary =
        result_text ||
        (tracking_code ? `کد رهگیری: ${tracking_code}` : 'درخواست با موفقیت انجام شد.');

      const resultData = {
        summary,
        tracking_code: tracking_code ?? null,
        manager_id: manager_id ?? job.assigned_manager_id ?? null,
        completed_at: new Date().toISOString(),
      };

      await jobsRepo.complete(Number(job_id), resultData);
      if (manager_id || job.assigned_manager_id) {
        await managersRepo.recordCompletion(String(manager_id ?? job.assigned_manager_id));
      }
      if (job.slot_id) {
        await slotsRepo.completeSlot(job.slot_id);
      }

      const taskNameFa = TASK_NAME_FA[job.task_type] ?? job.task_type;
      await customerApi
        .sendMessage({
          chat_id: job.user_id,
          parse_mode: 'HTML',
          text:
            `✅ <b>درخواست ${taskNameFa} (#${job.id}) با موفقیت تکمیل شد!</b>\n\n` +
            `📋 <b>نتیجه:</b>\n<code>${summary}</code>`,
          reply_markup: {
            inline_keyboard: [
              [
                { text: '⭐ ۱', callback_data: `RATE_JOB:${job.id}:1` },
                { text: '⭐⭐ ۲', callback_data: `RATE_JOB:${job.id}:2` },
                { text: '⭐⭐⭐ ۳', callback_data: `RATE_JOB:${job.id}:3` },
                { text: '⭐⭐⭐⭐ ۴', callback_data: `RATE_JOB:${job.id}:4` },
                { text: '⭐⭐⭐⭐⭐ ۵', callback_data: `RATE_JOB:${job.id}:5` },
              ],
            ],
          },
        })
        .catch(() => {});

      return { ok: true, job: await jobsRepo.findById(Number(job_id)) };
    }

    case 'fail_job': {
      const { job_id, error_message = 'خطا در ثبت سامانه' } = body;
      if (!job_id) return { ok: false, error: 'job_id الزامی است.' };
      const job = await jobsRepo.findById(Number(job_id));
      if (!job) return { ok: false, error: 'درخواست یافت نشد.' };
      await jobsRepo.fail(Number(job_id), error_message);
      const taskNameFa = TASK_NAME_FA[job.task_type] ?? job.task_type;
      await customerApi
        .sendMessage({
          chat_id: job.user_id,
          text: `❌ درخواست ${taskNameFa} (#${job.id}) ناموفق بود.\n⚠️ علت: ${error_message}`,
          reply_markup: {
            inline_keyboard: [[{ text: '🔄 تلاش مجدد', callback_data: `RETRY_JOB:${job.id}` }]],
          },
        })
        .catch(() => {});
      return { ok: true, job: await jobsRepo.findById(Number(job_id)) };
    }

    case 'reply_support_ticket': {
      const { ticket_id, manager_id = 'n8n_agent', text } = body;
      if (!ticket_id || !text) return { ok: false, error: 'ticket_id و text الزامی است.' };
      const updated = await ticketsRepo.addMessage(Number(ticket_id), 'manager', String(manager_id), text, 'ANSWERED');
      if (!updated) return { ok: false, error: 'تیکت یافت نشد.' };
      await customerApi
        .sendMessage({
          chat_id: updated.user_id,
          parse_mode: 'HTML',
          text: `💬 <b>پاسخ پشتیبانی (تیکت #${updated.id}):</b>\n\n${text}`,
        })
        .catch(() => {});
      return { ok: true, ticket: updated };
    }

    default:
      return {
        ok: false,
        error: `اکشن n8n ناشناخته است: "${action}"`,
        supported_actions: [
          'list_services',
          'list_open_slots',
          'register_manager',
          'set_manager_slots',
          'create_service_job',
          'claim_job',
          'complete_job',
          'fail_job',
          'reply_support_ticket',
        ],
      };
  }
}

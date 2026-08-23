import { query } from '../db/pool.js';
import { notifyUser } from '../notifications/notify.js';
import { sendTemplatedSms, isMsg91Configured } from '../integrations/sms/msg91.js';
import { isTemplateConfigured } from '../integrations/sms/templates.js';

// Every minute. The lead time is configured in hours, so minute
// granularity is far more precision than needed — but it keeps a
// reminder from being up to 30 minutes late, which for a 2-hour warning
// would be a meaningful chunk of the notice.
const CHECK_INTERVAL_MS = 60 * 1000;

const BUSINESS_TZ = 'Australia/Melbourne';

/**
 * Remind assigned vets before their appointment.
 *
 * Runs in the API process alongside the dispatch worker. Same caveat
 * applies: on a single instance this is fine, but if the API is ever
 * scaled horizontally this needs to move to a real scheduler or every
 * instance will send its own copy of each reminder.
 */
export function startReminderWorker() {
  setInterval(async () => {
    try {
      const { rows: settingsRows } = await query('SELECT config FROM pricing_settings WHERE id = true');
      const config = settingsRows[0]?.config || {};

      // Admin can switch reminders off entirely without a deploy.
      if (config.remindersEnabled === false) return;

      const hoursBefore = Number(config.reminderHoursBefore);
      const lead = Number.isFinite(hoursBefore) && hoursBefore > 0 ? hoursBefore : 2;

      // Jobs whose start is inside the lead window and not yet reminded.
      //
      // The lower bound matters as much as the upper one: without it, a
      // job created AFTER its own reminder window had passed — or one
      // the worker missed during a restart — would fire a "starting in 2
      // hours" alert for a visit already underway, or long past. Jobs
      // more than 15 minutes overdue are skipped and marked, so they
      // neither alert nor get retried forever.
      const { rows: jobs } = await query(
        `SELECT j.id, j.job_number, j.pet_name, j.job_date, j.job_time, j.suburb, j.address,
                j.assigned_vet_id,
                u.id AS user_id, u.full_name, u.phone,
                (j.job_date + j.job_time) AS starts_at
         FROM jobs j
         JOIN vets v ON v.id = j.assigned_vet_id
         JOIN users u ON u.id = v.user_id
         WHERE j.reminder_sent_at IS NULL
           AND j.status NOT IN ('completed', 'cancelled')
           AND j.assigned_vet_id IS NOT NULL
           AND (j.job_date + j.job_time)
                 BETWEEN (now() AT TIME ZONE $2) - INTERVAL '15 minutes'
                     AND (now() AT TIME ZONE $2) + ($1 || ' hours')::interval
         LIMIT 50`,
        [String(lead), BUSINESS_TZ]
      );

      for (const job of jobs) {
        // Mark FIRST, then notify. If the mark succeeded and the send
        // then failed, the vet misses one reminder. If it were the other
        // way round, a send failure after a successful notify would
        // re-alert them on every tick — a minute apart, indefinitely.
        // Missing one is much better than that.
        await query('UPDATE jobs SET reminder_sent_at = now() WHERE id = $1', [job.id]);

        const timeStr = String(job.job_time).slice(0, 5);
        const where = job.suburb || job.address || '';

        notifyUser(job.user_id, {
          title: `Appointment in about ${lead} hour${lead === 1 ? '' : 's'}`,
          body: `${job.pet_name} (${job.job_number}) at ${timeStr}${where ? ` — ${where}` : ''}.`,
          url: `/jobs/${job.id}`,
          category: 'job',
        }).catch((e) => console.error('reminder notify failed:', e.message));

        // SMS as well: a push can be missed or disabled, and this is the
        // notification where being missed actually costs a visit.
        if (isMsg91Configured() && isTemplateConfigured('vetAppointmentReminder') && job.phone) {
          sendTemplatedSms(job.phone, 'vetAppointmentReminder', {
            vet_name: job.full_name,
            pet_name: job.pet_name,
            job_time: timeStr,
            suburb: where,
          }).catch((e) => console.error('reminder SMS failed:', e.message));
        }
      }
    } catch (err) {
      console.error('Reminder worker error:', err.message);
    }
  }, CHECK_INTERVAL_MS);

  console.log(`Appointment reminder worker started (checking every ${CHECK_INTERVAL_MS / 1000}s)`);
}

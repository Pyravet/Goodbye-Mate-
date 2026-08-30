import { query } from '../db/pool.js';
import { createBurstGate } from './schedule.js';
import { createBackoff } from './backoff.js';
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
  const backoff = createBackoff('Reminder worker');
  // Work in bursts and leave real gaps. Neon bills COMPUTE TIME and
  // suspends after ~5 min idle; continuous polling meant it never
  // suspended — 720 compute-hours a month against a ~191 allowance.
  // Hourly is plenty: reminders are sent N hours before an appointment,
  // so being up to an hour early or late is immaterial.
  const gate = createBurstGate({ windowMinutes: 60, burstSeconds: 60 });
  setInterval(async () => {
    // Skip entirely while the database is refusing work — retrying
    // every 30s cannot help and burns the quota that's exhausted.
    if (backoff.shouldSkip()) return;
    // Outside a burst, or outside working hours: don't touch the
    // database at all. This gap is the whole point — it's what lets the
    // compute suspend.
    if (!gate.allow()) return;
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
      backoff.ok();
    } catch (err) {
      backoff.fail(err);
      console.error('Reminder worker error:', err.message);
    }
  }, CHECK_INTERVAL_MS);

  console.log(`Appointment reminder worker started (checking every ${CHECK_INTERVAL_MS / 1000}s)`);
}

// Checked hourly, not every minute: the delay is measured in DAYS, so
// minute precision would be pointless load. It also keeps the nudge
// landing at a civil hour rather than whenever the visit happened to be.
const REVIEW_CHECK_INTERVAL_MS = 60 * 60 * 1000;

// Never text someone about a review before 9am or after 7pm local time.
// This message follows a euthanasia; arriving at 6am would be careless
// in a way that matters more than the review does.
const CIVIL_START_HOUR = 9;
const CIVIL_END_HOUR = 19;

/**
 * Ask clients to leave feedback a few days after the visit.
 *
 * Most people never reopen the journey link once the visit is done, so
 * without a nudge reviews only come from the handful who happen to.
 */
export function startReviewReminderWorker() {
  const backoff = createBackoff('Review reminder worker');
  // Its own gate: this is a separate function and can't see the
  // appointment worker's. Reviews are asked for days after a visit, so
  // an hour either way is immaterial.
  const gate = createBurstGate({ windowMinutes: 60, burstSeconds: 60 });
  setInterval(async () => {
    // Same guard as the other workers: pointless to retry against a
    // database that is refusing every query.
    if (backoff.shouldSkip()) return;
    // Outside a burst, or outside working hours: don't touch the
    // database at all. This gap is the whole point — it's what lets the
    // compute suspend.
    if (!gate.allow()) return;
    try {
      const { rows: settingsRows } = await query('SELECT config FROM pricing_settings WHERE id = true');
      const config = settingsRows[0]?.config || {};
      if (config.reviewRemindersEnabled === false) return;

      const configured = Number(config.reviewReminderDays);
      const days = Number.isFinite(configured) && configured > 0 ? configured : 2;

      const localHour = Number(
        new Intl.DateTimeFormat('en-AU', { hour: 'numeric', hour12: false, timeZone: BUSINESS_TZ })
          .format(new Date())
      );
      if (localHour < CIVIL_START_HOUR || localHour >= CIVIL_END_HOUR) return;

      const { rows: jobs } = await query(
        `SELECT j.id, j.client_name, j.client_phone, j.pet_name, j.client_token
         FROM jobs j
         LEFT JOIN job_reviews r ON r.job_id = j.id
         WHERE j.review_reminder_sent_at IS NULL
           AND j.status = 'completed'
           AND j.procedure_done_at IS NOT NULL
           AND j.procedure_done_at <= now() - ($1 || ' days')::interval
           -- Don't chase someone who has already reviewed.
           AND r.job_id IS NULL
           AND j.client_phone IS NOT NULL
         LIMIT 25`,
        [String(days)]
      );

      for (const job of jobs) {
        // Marked first for the same reason as the appointment reminder:
        // a send failure after marking costs one message, whereas
        // marking after sending would re-text a grieving client every
        // hour until it succeeded.
        await query('UPDATE jobs SET review_reminder_sent_at = now() WHERE id = $1', [job.id]);

        if (isMsg91Configured() && isTemplateConfigured('clientReviewReminder')) {
          sendTemplatedSms(job.client_phone, 'clientReviewReminder', {
            client_name: job.client_name,
            pet_name: job.pet_name,
            link: `${process.env.CLIENT_APP_URL || ''}/${job.client_token}`,
          }).catch((e) => console.error('review reminder SMS failed:', e.message));
        }
      }
      backoff.ok();
    } catch (err) {
      backoff.fail(err);
      console.error('Review reminder worker error:', err.message);
    }
  }, REVIEW_CHECK_INTERVAL_MS);

  console.log(`Review reminder worker started (checking hourly)`);
}

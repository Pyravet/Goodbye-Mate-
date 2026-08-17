// Slack notifications via an Incoming Webhook — the simplest way to get
// alerts into a Slack channel, and far lower-friction than building a
// full Slack App (OAuth, bot token, scopes, workspace install).
//
// To enable: in Slack, add the "Incoming Webhooks" app to the desired
// channel (or ask a workspace admin to), copy the generated webhook URL,
// and set it as SLACK_WEBHOOK_URL in this service's environment
// variables. Nothing else needs to change — every call below already
// checks for it and fails soft if it's missing.

export function isSlackConfigured() {
  return !!process.env.SLACK_WEBHOOK_URL;
}

export async function sendSlackMessage(text) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return; // silently skip — Slack isn't set up yet

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      console.error('Slack webhook send failed:', res.status, await res.text().catch(() => ''));
    }
  } catch (err) {
    console.error('Slack webhook send failed:', err.message);
  }
}

// MSG91 SMS adapter — https://api.msg91.com/api/v5/flow/
//
// MSG91's v5 API is template ("flow") based: you pre-create a message
// template in the MSG91 dashboard (with a flow_id) and send variables
// into it, rather than posting arbitrary free text. This is the modern,
// supported path (their older free-text endpoints are legacy/deprecated).
//
// Since our messages are AI-drafted per-enquiry text rather than a fixed
// template, we'd want ONE simple flow/template in MSG91 shaped like:
//   "{{message}}"
// i.e. a template that's just a single variable holding the whole body.
// Confirm with MSG91 (or their dashboard) that a single-variable
// passthrough template is acceptable for your account/route — and that
// the account can send to +61 (Australian) numbers, since MSG91 is
// primarily built around Indian carriers/DLT compliance.

const MSG91_FLOW_URL = 'https://api.msg91.com/api/v5/flow/';

export async function sendSmsMsg91(toE164, text) {
  const authkey = process.env.MSG91_AUTH_KEY;
  const flowId = process.env.MSG91_FLOW_ID;
  const senderId = process.env.MSG91_SENDER_ID;

  if (!authkey || !flowId || !senderId) {
    throw new Error('MSG91 not configured: set MSG91_AUTH_KEY, MSG91_FLOW_ID, MSG91_SENDER_ID');
  }

  const body = {
    flow_id: flowId,
    sender: senderId,
    recipients: [
      {
        mobiles: toE164.replace(/^\+/, ''), // MSG91 expects country code without a leading '+'
        message: text, // must match the variable name used in the MSG91 template
      },
    ],
  };

  const res = await fetch(MSG91_FLOW_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      authkey,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok || data?.type === 'error') {
    const err = new Error(data?.message || `MSG91 send failed (HTTP ${res.status})`);
    err.providerResponse = data;
    throw err;
  }

  return data; // { message: "<request id>", type: "success" }
}

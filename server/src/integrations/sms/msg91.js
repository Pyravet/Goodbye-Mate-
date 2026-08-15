// MSG91 SMS adapter — https://api.msg91.com/api/v5/flow/
//
// Real templates configured in the MSG91 dashboard (see templates.js) —
// each is fixed wording with named variable placeholders, not free text.
// This sends by template key + a { varName: value } object; the values
// are matched by name, not position, so they must exactly match the
// variable names configured in the MSG91 template editor.

import { SMS_TEMPLATES, isTemplateConfigured } from './templates.js';

const MSG91_FLOW_URL = 'https://api.msg91.com/api/v5/flow/';

export function isMsg91Configured() {
  return !!process.env.MSG91_AUTH_KEY;
}

// AU numbers are typically stored as entered (04xx xxx xxx or +614xx...).
// MSG91 wants the country code with no leading '+'.
export function toMsg91Mobile(rawPhone) {
  const digits = String(rawPhone).replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits.slice(1);
  if (digits.startsWith('0')) return `61${digits.slice(1)}`; // AU trunk prefix -> country code
  if (digits.startsWith('61')) return digits;
  return digits; // already looks like it has a country code, or unrecognised — pass through
}

// templateKey: one of the keys in SMS_TEMPLATES (see templates.js).
// variables: { varName: value } — must cover every name in that
// template's `vars` list, matching MSG91's configured variable names.
export async function sendTemplatedSms(toRawPhone, templateKey, variables) {
  const authkey = process.env.MSG91_AUTH_KEY;
  const template = SMS_TEMPLATES[templateKey];

  if (!authkey) {
    throw new Error('MSG91 not configured: set MSG91_AUTH_KEY');
  }
  if (!template) {
    throw new Error(`Unknown SMS template key: ${templateKey}`);
  }
  if (!isTemplateConfigured(templateKey)) {
    throw new Error(`Template "${templateKey}" has no flowId set yet — see templates.js`);
  }
  if (!template.senderId) {
    throw new Error(`Template "${templateKey}" has no senderId set — see templates.js`);
  }

  const missing = template.vars.filter((v) => !(v in variables));
  if (missing.length) {
    throw new Error(`Missing variables for template "${templateKey}": ${missing.join(', ')}`);
  }

  const body = {
    flow_id: template.flowId,
    sender: template.senderId,
    recipients: [
      {
        mobiles: toMsg91Mobile(toRawPhone),
        ...variables,
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

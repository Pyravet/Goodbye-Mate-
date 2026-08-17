// WhatsApp via MSG91's WhatsApp Business API.
//
// This is a separate product from MSG91's SMS flows: it requires its own
// setup in the MSG91 dashboard — a verified WhatsApp Business number
// (the "integrated number") plus at least one message template approved
// by Meta. Neither exists yet for this account, so every call here is
// gated behind isWhatsappConfigured() and fails soft rather than
// pretending to send. Once the business completes that setup, set:
//   MSG91_WHATSAPP_INTEGRATED_NUMBER=<the approved WhatsApp number>
//   MSG91_WHATSAPP_QUOTE_TEMPLATE=<Meta-approved template name>
// and this starts working with no other code changes.

import { toMsg91Mobile } from '../sms/msg91.js';

const MSG91_WHATSAPP_URL = 'https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/';

export function isWhatsappConfigured() {
  return !!(
    process.env.MSG91_AUTH_KEY &&
    process.env.MSG91_WHATSAPP_INTEGRATED_NUMBER &&
    process.env.MSG91_WHATSAPP_QUOTE_TEMPLATE
  );
}

// bodyParams: ordered array of strings filling the template's placeholders,
// in the order they were defined when the template was submitted to Meta.
export async function sendWhatsappTemplate(toRawPhone, bodyParams) {
  const authkey = process.env.MSG91_AUTH_KEY;
  const integratedNumber = process.env.MSG91_WHATSAPP_INTEGRATED_NUMBER;
  const templateName = process.env.MSG91_WHATSAPP_QUOTE_TEMPLATE;

  if (!isWhatsappConfigured()) {
    throw new Error('WhatsApp is not configured yet — see server/src/integrations/whatsapp/msg91Whatsapp.js');
  }

  const body = {
    integrated_number: integratedNumber,
    content_type: 'template',
    payload: {
      to: toMsg91Mobile(toRawPhone),
      type: 'template',
      template: {
        name: templateName,
        language: { code: 'en', policy: 'deterministic' },
        to_and_components: [
          {
            to: [toMsg91Mobile(toRawPhone)],
            components: {
              body_1: { type: 'text', value: bodyParams.join(' | ') },
            },
          },
        ],
      },
    },
  };

  const res = await fetch(MSG91_WHATSAPP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', authkey },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || data?.type === 'error') {
    const err = new Error(data?.message || `MSG91 WhatsApp send failed (HTTP ${res.status})`);
    err.providerResponse = data;
    throw err;
  }
  return data;
}

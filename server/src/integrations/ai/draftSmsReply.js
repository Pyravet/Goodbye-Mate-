// Asks Claude to draft an SMS reply from enquiry context, returning
// strict JSON so it can be parsed reliably. ANTHROPIC_API_KEY isn't set
// yet (Phase 1 stub) — this will throw a clear error until it is, rather
// than silently failing.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';

export async function draftSmsReply(context) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not set — AI drafting is stubbed until this is provided');
  }

  const systemPrompt = `You are drafting an SMS reply for Goodbye Mate, an at-home pet euthanasia
service in Australia. You will be given enquiry context (what the client asked, and
relevant pricing/availability facts). Draft a warm, brief, factually accurate SMS reply.

Respond with ONLY a JSON object, no other text, no markdown fences:
{"sms_text": "the reply, 320 characters or fewer"}`;

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: 'user', content: JSON.stringify(context) }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Claude API error (HTTP ${res.status}): ${body}`);
  }

  const data = await res.json();
  const textBlock = data.content?.find((c) => c.type === 'text');
  if (!textBlock) throw new Error('Claude response had no text content');

  return textBlock.text; // raw string — caller extracts/validates the JSON
}

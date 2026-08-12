// Guards against Claude drafting something too long for a single SMS,
// or the JSON extraction picking up junk instead of real message text.
export function validateSmsText(text, maxLength = 320) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return { ok: false, reason: 'sms_text missing or empty' };
  }
  const trimmed = text.trim();
  if (trimmed.length > maxLength) {
    return { ok: false, reason: `sms_text exceeds ${maxLength} characters (${trimmed.length})` };
  }
  return { ok: true, text: trimmed };
}

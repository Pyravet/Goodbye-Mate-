// Real MSG91 templates, as configured in the MSG91 dashboard. Each has
// FIXED wording with named variable placeholders — the variable names
// here must exactly match what's typed into the MSG91 template editor
// (##client_name##, ##pet_name##, etc.), so this registry is the single
// source of truth for which vars each template expects.
//
// IMPORTANT: each template has its OWN Sender ID — they are not all the
// same. Most use "GBM"; the newer passthrough template uses "AusGBM".
// Sender ID is just the public "from" label shown to the recipient, not
// a secret, so it's fine to hardcode here alongside the template IDs.
//
// ToClient_Vet_Assign's ID is not yet known — ask the business for it if
// personalised (name-included) vet-assigned texts to clients are wanted;
// until then, the generic no-variable version below is used instead.

export const SMS_TEMPLATES = {
  bookingReceived: {
    flowId: '687f2dc8d6fc053c7c39d9c2',
    senderId: 'GBM',
    vars: ['client_name', 'pet_name', 'book_day', 'book_date', 'book_time', 'book_address'],
    description: 'Client-facing: booking received, awaiting vet assignment.',
  },
  vetAssignedLinkOnly: {
    flowId: '689d9e3691527b4a976ca3f2',
    senderId: 'GBM',
    vars: ['link'],
    description: 'Vet-facing: "a job has been assigned to you" with a portal link (no name/pet details — superseded by vetAssignedToVet below, kept for reference).',
  },
  clientVetAssignedGeneric: {
    flowId: '689d9dfdc09d5c7d9e0fb453',
    senderId: 'GBM',
    vars: [],
    description: 'Client-facing: vet assigned, fully generic wording (no variables at all).',
  },
  vetAssignedToVet: {
    flowId: '689d9180ed744f02eb6dc423',
    senderId: 'GBM',
    vars: ['vet_name', 'pet_name', 'book_day', 'book_date', 'book_time', 'book_address', 'link'],
    description: 'Vet-facing: assigned to a booking, with full details + portal link.',
  },
  // ToClient_Vet_Assign — personalised client-facing "vet assigned" message
  // (client_name, vet_name, pet_name, book_day/date/time, book_address).
  // flowId intentionally left blank — fill in once known, then switch
  // messages.js over to this instead of clientVetAssignedGeneric.
  clientVetAssignedNamed: {
    flowId: null,
    senderId: 'GBM',
    vars: ['client_name', 'vet_name', 'pet_name', 'book_day', 'book_date', 'book_time', 'book_address'],
    description: 'Client-facing: vet assigned, personalised with names — flowId pending.',
  },
  enquiryNotification: {
    flowId: '6889ac90d6fc057d3b0ed922',
    senderId: 'GBM',
    vars: ['client_name', 'client_phone', 'client_email', 'pet_name'],
    description: 'Internal: notifies staff of a new website enquiry (not yet wired to a trigger — no "enquiry" concept exists separately from a full booking yet).',
  },
  genericMessage: {
    flowId: '6a807748d13abb6b5d023a23',
    senderId: 'AusGBM',
    vars: ['message'],
    description: 'Free-text passthrough — one variable holds the whole message body. Template wording is "##message## / Thank you for trusting goodbye mate", so a sign-off line is appended automatically by MSG91, not by us. Used for AI-drafted quotes/replies.',
  },
};

export function isTemplateConfigured(key) {
  return !!SMS_TEMPLATES[key]?.flowId;
}

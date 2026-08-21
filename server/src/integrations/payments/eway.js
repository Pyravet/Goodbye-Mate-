// eWay Rapid API (v3.1) — Direct Connection, Client Side Encryption.
//
// The server NEVER sees a raw card number: the admin app encrypts card
// fields in the browser using eWay's eCrypt.js and the *public* API key
// before they're sent here. This function just forwards those already-
// encrypted values to eWay, who decrypt them on their end using the key
// tied to the public key — so full card numbers never touch our server
// or database. That's the whole point of Client Side Encryption.
//
// Requires (Railway env vars, server-side secrets — never in frontend code):
//   EWAY_API_KEY, EWAY_API_PASSWORD, EWAY_ENDPOINT

export function isEwayConfigured() {
  return !!(process.env.EWAY_API_KEY && process.env.EWAY_API_PASSWORD && process.env.EWAY_ENDPOINT);
}

// amount: dollars (e.g. 350.00) — eWay wants the total in the smallest
// currency unit (cents for AUD), so it's converted here.

/**
 * eWay returns failures as terse codes, e.g. "V6021" or "D4406", and
 * they're the whole diagnosis — a wrong endpoint, an unencrypted field
 * and a genuinely declined card all look identical without decoding
 * them. "Unknown response" told nobody anything.
 *
 * V-codes are VALIDATION errors (our request was wrong). D-codes come
 * from the bank (the card itself was declined). That distinction matters:
 * one is a bug to fix, the other is the client needing another card.
 */
const EWAY_CODES = {
  V6021: 'Cardholder name is required.',
  V6022: 'Card number is required.',
  V6023: 'Card CVN (security code) is required.',
  V6033: 'Card has expired, or the expiry date is invalid.',
  V6034: 'Invoice reference is too long.',
  V6039: 'Invalid card expiry month.',
  V6040: 'Invalid card expiry year.',
  V6041: 'Invalid card number.',
  V6042: 'Cardholder first name is required.',
  V6043: 'Cardholder last name is required.',
  V6047: 'Invalid card start month.',
  V6055: 'Invalid card number format.',
  V6059: 'Redirect URL is invalid.',
  V6060: 'Invalid API key or password for this endpoint.',
  V6068: 'Payment total amount is invalid.',
  V6084: 'Card details could not be decrypted — the Client Side Encryption key does not match this eWay account or endpoint.',
  V6091: 'Unknown currency code.',
  V6100: 'Invalid card number.',
  V6101: 'Invalid card expiry month.',
  V6102: 'Invalid card expiry year.',
  V6106: 'Invalid card CVN.',
  V6110: 'Invalid card number.',
  D4401: 'Declined — refer to card issuer.',
  D4404: 'Declined — pick up card.',
  D4405: 'Declined — do not honour.',
  D4406: 'Declined — insufficient funds.',
  D4407: 'Declined — expired card.',
  D4412: 'Declined — invalid transaction.',
  D4414: 'Declined — invalid card number.',
  D4415: 'Declined — no issuer found.',
  D4451: 'Declined — insufficient funds.',
  D4454: 'Declined — expired card.',
  D4491: 'Declined — card issuer unavailable, try again shortly.',
  A2000: 'Approved.',
  A2008: 'Approved — honour with identification.',
};

/**
 * Turn eWay's raw codes into something a person can act on.
 * @param {object} data eWay response body.
 */
function describeEwayResult(data) {
  // Errors can arrive as a comma-separated string or an array.
  const raw = data?.Errors ?? data?.ResponseCode ?? data?.ResponseMessage ?? '';
  const codes = String(Array.isArray(raw) ? raw.join(',') : raw)
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);

  const described = codes.map((c) => EWAY_CODES[c] || c);
  if (described.length > 0) return described.join(' ');

  // Nothing usable came back — say so honestly rather than pretending
  // the card was declined.
  return 'The payment gateway returned no reason. Check the eWay endpoint and API credentials.';
}


/**
 * Normalise EWAY_ENDPOINT into a base URL.
 *
 * The charge path used EWAY_ENDPOINT verbatim (expecting it to already
 * end in /Transaction) while the refund path appended
 * "/Transaction/<id>/Refund" to it — so whichever way the variable was
 * set, one of the two was wrong. If it's set with the full path, a
 * refund would hit ".../Transaction/Transaction/<id>/Refund".
 *
 * Accepting either form removes a configuration trap that produces a
 * 404 the gateway reports as an unhelpful generic failure.
 */
function ewayBase() {
  return String(process.env.EWAY_ENDPOINT || '').replace(/\/+$/, '').replace(/\/Transaction$/i, '');
}

export async function chargeCard({ amountDollars, invoiceReference, customerName, encryptedCard }) {
  if (!isEwayConfigured()) {
    throw new Error('eWay is not configured — set EWAY_API_KEY, EWAY_API_PASSWORD, EWAY_ENDPOINT.');
  }

  const auth = Buffer.from(`${process.env.EWAY_API_KEY}:${process.env.EWAY_API_PASSWORD}`).toString('base64');

  const body = {
    Method: 'ProcessPayment',
    TransactionType: 'Purchase',
    Customer: {
      FirstName: customerName?.split(' ')[0] || 'Customer',
      LastName: customerName?.split(' ').slice(1).join(' ') || '',
      CardDetails: {
        Name: customerName || 'Customer',
        Number: encryptedCard.number,
        ExpiryMonth: encryptedCard.expiryMonth,
        ExpiryYear: encryptedCard.expiryYear,
        CVN: encryptedCard.cvn,
      },
    },
    Payment: {
      TotalAmount: Math.round(Number(amountDollars) * 100),
      InvoiceReference: invoiceReference,
      CurrencyCode: 'AUD',
    },
  };

  const chargeUrl = `${ewayBase()}/Transaction`;
  const res = await fetch(chargeUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  const success = data.TransactionStatus === true;

  // Log the FULL response on failure. Payments failing with no
  // server-side record of why is what made this undiagnosable — the
  // response was parsed, reduced to "Unknown response" and thrown away.
  // Card details are never in this body (they were encrypted in the
  // browser), so there's nothing sensitive to leak.
  if (!success) {
    // Log the URL too. A 404 means we're posting to a path eWay doesn't
    // serve, and without seeing the resolved URL there's no way to tell
    // a wrong EWAY_ENDPOINT from a credentials problem. The URL contains
    // no secrets — auth is a header.
    console.error('eWay charge failed. HTTP', res.status, 'URL:', chargeUrl, 'body:', JSON.stringify(data));

    if (res.status === 404) {
      console.error(
        'eWay 404: EWAY_ENDPOINT is wrong. It must be the Rapid API host — '
        + 'https://api.sandbox.ewaypayments.com (sandbox) or https://api.ewaypayments.com (live). '
        + 'A Rapid 3.1 style path such as /CreateAccessCode.json will 404 here.'
      );
    }
  }

  // eWay returns TransactionStatus: true/false regardless of HTTP status —
  // that's the real success/failure signal, not res.ok.
  return {
    success,
    transactionId: data.TransactionID || null,
    responseMessage: success
      ? (data.ResponseMessage || 'Approved')
      // A 404 is a configuration fault, not a declined card, and saying
      // "declined" would send admin chasing the client for another card
      // when nothing is wrong with the one they gave.
      : res.status === 404
        ? 'Payment gateway not reachable at the configured address — EWAY_ENDPOINT is wrong. No card was charged.'
        : describeEwayResult(data),
    raw: data,
  };
}

/**
 * Refund a previously settled transaction via eWay's Refund endpoint.
 *
 * eWay refunds reference the ORIGINAL transaction id rather than card
 * details — the card was never stored on our side (that's the point of
 * Client Side Encryption), so a refund can only ever be issued against
 * a transaction we already processed.
 *
 * Supports partial refunds: pass an amount smaller than the original.
 * eWay rejects an amount larger than what was captured, so over-refunding
 * fails at the provider rather than silently succeeding.
 *
 * @param {object} args
 * @param {string} args.transactionId eWay TransactionID from the charge.
 * @param {number} args.amountDollars Amount to refund, in dollars.
 * @param {string} [args.invoiceReference]
 * @returns {Promise<{success: boolean, refundTransactionId: string|null, responseMessage: string}>}
 */
export async function refundTransaction({ transactionId, amountDollars, invoiceReference }) {
  if (!isEwayConfigured()) {
    throw new Error('eWay is not configured — set EWAY_API_KEY, EWAY_API_PASSWORD, EWAY_ENDPOINT.');
  }
  if (!transactionId) {
    throw new Error('No original transaction id — this payment cannot be refunded automatically.');
  }

  const auth = Buffer.from(
    `${process.env.EWAY_API_KEY}:${process.env.EWAY_API_PASSWORD}`
  ).toString('base64');

  const body = {
    Refund: {
      TransactionID: String(transactionId),
      // Cents, like the charge path.
      TotalAmount: Math.round(Number(amountDollars) * 100),
      CurrencyCode: 'AUD',
      InvoiceReference: invoiceReference || undefined,
    },
  };

  const res = await fetch(`${ewayBase()}/Transaction/${transactionId}/Refund`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));

  // eWay signals success via TransactionStatus, not the HTTP status —
  // a declined refund still returns 200.
  const success = data?.TransactionStatus === true;
  const errors = data?.Errors || data?.ResponseMessage || '';

  return {
    success,
    refundTransactionId: data?.TransactionID ? String(data.TransactionID) : null,
    responseMessage: success ? 'Refunded' : (errors || 'Refund was declined by the payment gateway.'),
  };
}

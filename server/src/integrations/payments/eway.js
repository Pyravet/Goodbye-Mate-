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

  const res = await fetch(process.env.EWAY_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  // eWay returns TransactionStatus: true/false regardless of HTTP status —
  // that's the real success/failure signal, not res.ok.
  return {
    success: data.TransactionStatus === true,
    transactionId: data.TransactionID || null,
    responseMessage: (data.ResponseMessage || (data.Errors ? data.Errors : '')) || 'Unknown response',
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

  const res = await fetch(`${process.env.EWAY_ENDPOINT}/Transaction/${transactionId}/Refund`, {
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

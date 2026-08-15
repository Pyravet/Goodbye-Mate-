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

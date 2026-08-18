// Ported directly from the prototype's billBreakdown / payoutBreakdown.
// GST note (from the brief): payout amounts are GST-inclusive — GST is
// extracted from the total for reporting, never added on top.

function getService(pricing, serviceId) {
  return pricing.services.find((s) => s.id === serviceId) || pricing.services[0];
}

// Midnight band: 12am–6am. Computed straight from job_time — no new job
// field needed, unlike public holiday (which the calendar can't tell us).
function isMidnightBand(timeStr) {
  if (!timeStr) return false;
  const hour = Number(timeStr.split(':')[0]);
  return hour >= 0 && hour < 6;
}

// lineItems: optional [{ label, amount, vet_payout }] from job_line_items.
// Passed in rather than fetched here so this stays a pure function with
// no DB access — which is what makes it directly unit-testable.
export function billBreakdown(job, pricing, lineItems = []) {
  const service = getService(pricing, job.service_id);
  const isAfterHours = job.time_category === 'afterhours_weekend';
  const isMidnight = isMidnightBand(job.job_time);

  const lines = [
    { label: service ? service.name : 'Service', amount: service ? service.clientPrice : 0 },
    { label: 'Transfer fee', amount: pricing.transferFee.clientPrice },
  ];
  if (isAfterHours) lines.push({ label: 'After hours / weekend surcharge', amount: pricing.afterHoursSurcharge });
  if (job.is_public_holiday) lines.push({ label: 'Public holiday surcharge', amount: pricing.publicHolidaySurcharge || 0 });
  if (isMidnight) lines.push({ label: 'Midnight fee (12am\u20136am)', amount: pricing.midnightFeeSurcharge || 0 });
  if (job.service_type === 'communal_cremation') lines.push({ label: 'Communal cremation', amount: pricing.communalCremationFee });
  if (Number(job.extra_travel_fee) > 0) lines.push({ label: 'Extra travel fee', amount: Number(job.extra_travel_fee) });

  // Ad-hoc extras and discounts. Discounts are simply negative amounts,
  // so the total stays one sum rather than two divergent code paths.
  for (const item of lineItems) {
    lines.push({ label: item.label, amount: Number(item.amount) });
  }

  const total = lines.reduce((sum, l) => sum + Number(l.amount), 0);
  return { lines, total: Math.round(total * 100) / 100 };
}

export function payoutBreakdown(job, pricing, lineItems = []) {
  const service = getService(pricing, job.service_id);
  const isAfterHours = job.time_category === 'afterhours_weekend';

  const serviceAmt = service ? (isAfterHours ? service.vetAfterhours : service.vetWeekday) : 0;
  const transferAmt = isAfterHours ? pricing.transferFee.vetAfterhours : pricing.transferFee.vetWeekday;
  const travelAmt = Number(job.extra_travel_fee) || 0;

  // Only the portion of each line item explicitly marked as passing
  // through to the vet. A goodwill discount reduces what the client pays
  // without cutting the vet's payout, so these are tracked separately
  // rather than derived from the client-facing amount.
  const lineItemsAmt = lineItems.reduce((sum, i) => sum + (Number(i.vet_payout) || 0), 0);

  return {
    serviceName: service ? service.name : 'Service',
    serviceAmt,
    transferAmt,
    travelAmt,
    lineItemsAmt,
    total: Math.round((serviceAmt + transferAmt + travelAmt + lineItemsAmt) * 100) / 100,
  };
}

// GST is extracted from a GST-inclusive total: gst = total * rate / (100 + rate).
// Only broken out on an RCTI if the vet is GST-registered.
export function extractGst(gstInclusiveTotal, gstPercent) {
  const gstAmount = gstInclusiveTotal * (gstPercent / (100 + gstPercent));
  return {
    gstAmount: Math.round(gstAmount * 100) / 100,
    exGstAmount: Math.round((gstInclusiveTotal - gstAmount) * 100) / 100,
  };
}

export function jobRevenue(job, pricing) {
  return billBreakdown(job, pricing).total;
}

export function vetPayout(job, pricing) {
  return payoutBreakdown(job, pricing).total;
}

// Weekday vs after-hours/weekend/public-holiday. Public holidays aren't
// modeled yet (would need an AU public holiday calendar per state) —
// flagged as a follow-up, currently only weekday/weekend/hour is checked,
// matching the prototype exactly.
export function suggestTimeCategory(dateStr, timeStr) {
  if (!dateStr || !timeStr) return 'weekday';
  const d = new Date(`${dateStr}T${timeStr}`);
  const day = d.getDay();
  const hour = d.getHours();
  if (day === 0 || day === 6) return 'afterhours_weekend';
  if (hour >= 18 || hour < 7) return 'afterhours_weekend';
  return 'weekday';
}

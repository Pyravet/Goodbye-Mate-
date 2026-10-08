// What a vet may see on the job-detail response. The admin response
// includes the client bill (what the family was charged) and which
// referral partner sent the job; neither is the vet's business — the
// bill reveals the business's margin over the vet payout.
export function vetSafeJobResponse(full) {
  return {
    job: full.job,
    review: full.review,
    payout: full.payout,
    payoutLines: full.payoutLines,
  };
}

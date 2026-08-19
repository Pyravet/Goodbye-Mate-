/**
 * Fetch an authenticated PDF and present it to the user.
 *
 * Why not just window.open(url)? These endpoints require an
 * Authorization header, which a plain navigation can't send — it would
 * 401.
 *
 * Why not window.open(blobUrl) after fetching? Safari (and iOS in
 * particular) blocks window.open when it isn't a direct, synchronous
 * result of a user gesture. After an `await` the gesture context is
 * gone, so the popup is silently swallowed — the button appears to do
 * nothing at all, which is exactly the symptom reported for the vet
 * record and RCTI buttons.
 *
 * Instead we create a temporary <a download> and click it. Anchor clicks
 * aren't subject to popup blocking, so this works reliably on iOS,
 * Android and desktop.
 *
 * @param {() => Promise<Response>} fetcher Performs the authenticated request.
 * @param {string} filename Suggested download name.
 */
export async function downloadPdf(fetcher, filename) {
  const res = await fetcher();
  if (!res.ok) {
    // Surface the server's message where there is one, rather than a
    // generic failure — these endpoints return real explanations
    // (e.g. "a receipt is available once payment has been received").
    let message = `Could not open that document (HTTP ${res.status}).`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* not JSON — keep the generic message */
    }
    throw new Error(message);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();

  // Give the browser time to start reading the blob before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

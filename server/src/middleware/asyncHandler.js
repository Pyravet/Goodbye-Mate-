// Express 4 doesn't forward errors thrown/rejected inside an async route
// handler to the error-handling middleware — the request just hangs, and
// an unhandled rejection can crash the whole process. This wrapper is the
// standard fix: it catches whatever the handler throws or rejects with
// and passes it to next(), so the existing global error handler in
// index.js always gets a chance to respond.
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

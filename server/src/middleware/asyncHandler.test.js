import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asyncHandler } from './asyncHandler.js';

// This is the exact bug the fix addresses: without asyncHandler, a
// rejected promise inside an async route handler never reaches next(),
// so Express's error middleware never runs.
test('asyncHandler: forwards a rejected promise to next()', async () => {
  const boom = new Error('boom');
  const handler = asyncHandler(async () => {
    throw boom;
  });

  let calledWith;
  const next = (err) => { calledWith = err; };

  await handler({}, {}, next);
  assert.equal(calledWith, boom);
});

test('asyncHandler: does not call next() when the handler succeeds', async () => {
  const handler = asyncHandler(async (req, res) => {
    res.done = true;
  });

  let nextCalled = false;
  const res = {};
  const next = () => { nextCalled = true; };

  await handler({}, res, next);
  assert.equal(res.done, true);
  assert.equal(nextCalled, false);
});

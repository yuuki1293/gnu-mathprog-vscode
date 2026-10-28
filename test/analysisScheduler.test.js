'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AnalysisScheduler } = require('../src/analysisScheduler');
const wait = () => new Promise(resolve => setTimeout(resolve, 15));
function fixture(analyze) {
  const results = [], statuses = [], cancellations = [];
  const scheduler = new AnalysisScheduler({ delay: 0, analyze,
    createCancellation() {
      const source = { token: { isCancellationRequested: false }, cancel() { this.token.isCancellationRequested = true; }, dispose() {} };
      cancellations.push(source); return source;
    }, publish: result => results.push(result), clear() {}, status: state => statuses.push(state) });
  return { scheduler, results, statuses, cancellations };
}

test('rapid saves are coalesced into one background check', async () => {
  let calls = 0;
  const f = fixture(async () => ++calls);
  f.scheduler.schedule(); f.scheduler.schedule(); f.scheduler.schedule(); await wait();
  assert.equal(calls, 1); assert.deepEqual(f.results, [1]); f.scheduler.dispose();
});

test('configuration changes cancel old checks, serialize processes, and discard stale results', async () => {
  const finishes = [];
  const f = fixture(() => new Promise(resolve => finishes.push(resolve)));
  f.scheduler.schedule(); await wait();
  f.scheduler.schedule(); await wait();
  assert.equal(f.cancellations[0].token.isCancellationRequested, true);
  assert.equal(finishes.length, 1);
  finishes[0]('old'); await wait();
  assert.equal(finishes.length, 2); assert.deepEqual(f.results, []);
  finishes[1]('new'); await wait();
  assert.deepEqual(f.results, ['new']); f.scheduler.dispose();
});

test('turning analysis off cancels work and prevents publication or new checks', async () => {
  let finish, calls = 0;
  const f = fixture(() => { calls++; return new Promise(resolve => { finish = resolve; }); });
  f.scheduler.schedule(); await wait(); f.scheduler.setEnabled(false);
  assert.equal(f.cancellations[0].token.isCancellationRequested, true);
  finish('stale'); await wait(); f.scheduler.schedule(); await wait();
  assert.equal(calls, 1); assert.deepEqual(f.results, []);
  assert.equal(f.statuses.at(-1), 'off'); f.scheduler.dispose();
});

test('manual runs suspend analysis until all nested pauses are released', async () => {
  let calls = 0;
  const f = fixture(async () => ++calls);
  await f.scheduler.pause(); await f.scheduler.pause(); f.scheduler.schedule(); await wait();
  assert.equal(calls, 0); f.scheduler.resume(); await wait(); assert.equal(calls, 0);
  f.scheduler.resume(); await wait(); assert.equal(calls, 1); f.scheduler.dispose();
});

test('invalidating an edited input clears obsolete results without running on unsaved text', async () => {
  let calls = 0;
  const f = fixture(async () => ++calls);
  f.scheduler.schedule(); f.scheduler.invalidate('dirty'); await wait();
  assert.equal(calls, 0); assert.equal(f.statuses.at(-1), 'dirty');
  f.scheduler.schedule(); await wait(); assert.equal(calls, 1); f.scheduler.dispose();
});

test('disposal cancels checks and late callbacks do not touch disposed UI', async () => {
  let finish;
  const f = fixture(() => new Promise(resolve => { finish = resolve; }));
  f.scheduler.schedule(); await wait(); f.scheduler.dispose();
  assert.equal(f.cancellations[0].token.isCancellationRequested, true);
  f.scheduler.clear = () => { throw new Error('disposed diagnostics'); };
  f.scheduler.status = () => { throw new Error('disposed button'); };
  f.scheduler.schedule(); f.scheduler.invalidate(); f.scheduler.resume();
  finish('obsolete'); await wait(); assert.deepEqual(f.results, []);
});

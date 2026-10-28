'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runSolver } = require('../src/solver');
const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };

test('streams output and returns exit status without executing shell metacharacters', async () => {
  const literal = '$(touch do-not-create); & space';
  let stream = '';
  const result = await runSolver(process.execPath, ['-e', 'console.log(process.argv[1]); console.error("error"); process.exitCode=3', literal],
    { cwd: __dirname, timeoutMs: 5000 }, token, s => stream += s);
  assert.equal(result.code, 3); assert.ok(result.output.includes(literal));
  assert.ok(stream.includes('error')); assert.equal(result.cancelled, false);
});

test('missing executable rejects with ENOENT', async () => {
  await assert.rejects(runSolver('/no-such-mathprog-executable', [], { cwd: __dirname, timeoutMs: 5000 }, token, () => {}), { code: 'ENOENT' });
});

test('watchdog terminates a stalled process', async () => {
  const result = await runSolver(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { cwd: __dirname, timeoutMs: 100 }, token, () => {});
  assert.equal(result.cancelled, true); assert.equal(result.timedOut, true);
});

test('cancellation terminates the process', async () => {
  let cancel, disposed = false;
  const cancellation = { isCancellationRequested: false, onCancellationRequested: fn => {
    cancel = fn; return { dispose() { disposed = true; } };
  } };
  const pending = runSolver(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { cwd: __dirname, timeoutMs: 5000 }, cancellation, () => {});
  cancel(); const result = await pending;
  assert.equal(result.cancelled, true); assert.equal(result.timedOut, false); assert.ok(disposed);
});

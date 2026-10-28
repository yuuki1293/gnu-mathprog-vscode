'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RunDebugAdapter } = require('../src/debugAdapter');
function adapter(execute) {
  const messages = [];
  const cancellation = { token: { isCancellationRequested: false }, cancel() { this.token.isCancellationRequested = true; }, dispose() {} };
  return { messages, cancellation, instance: new RunDebugAdapter(execute,
    { event() {}, fire: m => messages.push(m), dispose() {} }, cancellation) };
}
const request = (command, args = {}) => ({ type: 'request', command, seq: 1, arguments: args });
const flush = () => new Promise(resolve => setImmediate(resolve));

test('DAP launches the requested configuration, streams output, and terminates', async () => {
  const run = adapter(async (config, token, stream) => { assert.equal(config.name, 'A'); stream('result\n'); return { code: 0 }; });
  run.instance.handleMessage(request('initialize'));
  assert.ok(run.messages[0].body.supportsTerminateRequest);
  run.instance.handleMessage(request('launch', { name: 'A' }));
  await flush();
  assert.ok(run.messages.some(m => m.event === 'output' && m.body.output === 'result\n'));
  assert.ok(run.messages.some(m => m.event === 'exited' && m.body.exitCode === 0));
  assert.equal(run.messages.filter(m => m.event === 'terminated').length, 1);
});

test('DAP stop cancels execution and errors terminate cleanly', async () => {
  let finish;
  const run = adapter(() => new Promise(resolve => { finish = resolve; }));
  run.instance.handleMessage(request('launch')); await flush();
  run.instance.handleMessage(request('terminate'));
  assert.ok(run.cancellation.token.isCancellationRequested);
  finish({ cancelled: true }); await flush();
  assert.ok(run.messages.some(m => m.event === 'exited' && m.body.exitCode === 130));
  const failed = adapter(async () => { throw new Error('missing model'); });
  failed.instance.handleMessage(request('launch')); await flush();
  assert.ok(failed.messages.some(m => m.event === 'output' && m.body.output.includes('missing model')));
  assert.ok(failed.messages.some(m => m.event === 'terminated'));
});

'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { runSolver } = require('../src/solver');
const { solverArgs, parseDiagnostics } = require('../src/language');
const executable = process.env.MATHPROG_TEST_GLPSOL;
const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
const example = path.resolve(__dirname, '../examples/production.mod');
const run = (model, data, check) => runSolver(executable, solverArgs(model, data, check, 10),
  { cwd: path.dirname(model), timeoutMs: 15000 }, token, () => {});

test('GLPK solves inline and external data, checks models, and reports source errors', { skip: !executable }, async () => {
  const inline = await run(example);
  assert.equal(inline.code, 0); assert.match(inline.output, /Profit\.val = 260/);
  const external = await run(example, path.resolve(__dirname, '../examples/production.dat'));
  assert.equal(external.code, 0); assert.match(external.output, /Profit\.val = 400/);
  const check = await run(example, undefined, true);
  assert.equal(check.code, 0); assert.doesNotMatch(check.output, /INTEGER OPTIMAL/);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mathprog test '));
  try {
    const broken = path.join(dir, 'broken model.mod');
    await fs.writeFile(broken, 'var x >= 0;\nminimize Cost x;\nend;\n');
    const failure = await run(broken, undefined, true);
    assert.notEqual(failure.code, 0);
    const errors = parseDiagnostics(failure.output, dir);
    assert.equal(errors[0].file, broken); assert.equal(errors[0].line, 1);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

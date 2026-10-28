'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { resolveRunConfiguration, workspacePath } = require('../src/configuration');
const { solverArgs } = require('../src/language');
const root = path.resolve('/tmp/mathprog project');
const base = { type: 'mathprog', request: 'launch', name: 'Scenario A', model: 'models/production.mod' };

test('explicit configuration resolves model and ordered data relative to the workspace', () => {
  const config = resolveRunConfiguration({ ...base, data: ['data/sets.dat', 'data/values.dat'], cwd: 'results' }, root);
  assert.equal(config.model, path.join(root, 'models/production.mod'));
  assert.deepEqual(config.data, ['data/sets.dat', 'data/values.dat'].map(f => path.join(root, f)));
  assert.equal(config.cwd, path.join(root, 'results'));
  assert.equal(config.glpsolPath, 'glpsol'); assert.equal(config.action, 'run');
  assert.deepEqual(solverArgs(config.model, config.data, true, 25), [
    '--model', config.model, '--data', config.data[0], '--data', config.data[1], '--check', '--tmlim', '25'
  ]);
});

test('empty data uses inline data and config overrides workspace defaults', () => {
  const config = resolveRunConfiguration({ ...base, glpsolPath: 'tools/glpsol', timeLimit: 10, action: 'check' }, root,
    { glpsolPath: 'other', timeLimit: 30 });
  assert.deepEqual(config.data, []); assert.equal(config.cwd, root);
  assert.equal(config.glpsolPath, path.join(root, 'tools/glpsol'));
  assert.equal(config.timeLimit, 10); assert.equal(config.action, 'check');
  assert.ok(!solverArgs(config.model, [], false, 10).includes('--data'));
  assert.equal(resolveRunConfiguration(base, root, { timeLimit: 15 }).timeLimit, 15);
});

test('invalid or unresolved configurations fail before execution', () => {
  for (const patch of [{ model: '' }, { model: '${workspaceFolder}/x.mod' }, { data: 'data.dat' }, { data: [null] },
    { data: ['a.dat', './a.dat'] }, { data: Array.from({ length: 11 }, (_, i) => `${i}.dat`) },
    { timeLimit: 0 }, { timeLimit: 1.5 }, { timeLimit: 86401 }, { action: 'debug' }, { cwd: '' }, { glpsolPath: '' },
    { type: 'node' }, { request: 'attach' }, { name: '' }]) {
    assert.throws(() => resolveRunConfiguration({ ...base, ...patch }, root));
  }
  assert.throws(() => resolveRunConfiguration(base));
});

test('saved configurations keep explicit paths portable and literal filenames intact', () => {
  const filename = path.join(root, 'models/a $(literal).mod');
  assert.equal(workspacePath(root, filename), '${workspaceFolder}/models/a $(literal).mod');
  assert.equal(resolveRunConfiguration({ ...base, model: filename }, root).model, filename);
  assert.match(workspacePath(root, path.resolve(root, '../outside.mod')), /workspaceFolder.*\.\./);
});

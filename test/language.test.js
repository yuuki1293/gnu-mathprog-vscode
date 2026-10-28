'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mask, declarations, parseDiagnostics, solverArgs } = require('../src/language');

test('declarations ignore comments, strings, data and handle multiline constraints', () => {
  const text = `# var fake;\nset I; /* param fake; */\nparam c{I};\nvar x{I} >= 0;\nminimize Cost: sum {i in I} c[i]*x[i];\nsubject\n to Limit: sum {i in I} x[i] <= 4;\ns.t. Other: x['var hidden;'] >= 0;\nsolve;\ndata;\nset I := a b;\nparam c := a 1 b 2;\nend;`;
  const symbols = declarations(text);
  assert.deepEqual(symbols.map(s => s.name), ['I', 'c', 'x', 'Cost', 'Limit', 'Other']);
  for (const s of symbols) {
    assert.equal(text.slice(s.offset, s.offset + s.name.length), s.name);
    assert.ok(s.start <= s.offset && s.end >= s.offset + s.name.length);
  }
});

test('mask preserves offsets, newlines, doubled quotes, and incomplete comments', () => {
  const text = `param s := 'it''s # a string';\r\n/* var fake;\n */ var real; # comment`;
  const clean = mask(text);
  assert.equal(clean.length, text.length);
  assert.equal(clean.indexOf('real'), text.indexOf('real'));
  assert.equal(clean.split('\n').length, text.split('\n').length);
  assert.ok(!clean.includes('fake') && !clean.includes('string'));
  for (const prefix of ['# hello ', '/* hello ', '"hello ', "'hello "]) assert.ok(!mask(prefix + 'X').endsWith('X'));
  for (const prefix of ['# hello\n', '/* done */ ', '"done" ', "'it''s done' "]) assert.ok(mask(prefix + 'X').endsWith('X'));
});

test('diagnostic parser handles paths with spaces and Windows drive letters', () => {
  assert.deepEqual(parseDiagnostics('/tmp/a b.mod:12: syntax error\nTime used: 0.0 secs\n', '/tmp'), [
    { file: '/tmp/a b.mod', line: 11, message: 'syntax error' }
  ]);
  const win = parseDiagnostics('C:\\Models\\a.mod:3: missing semicolon', '/tmp');
  assert.equal(win[0].line, 2); assert.equal(win[0].message, 'missing semicolon');
});

test('solver arguments preserve filenames literally, including shell characters', () => {
  assert.deepEqual(solverArgs('/tmp/a $(touch bad).mod', '/tmp/b b.dat', true, 25), [
    '--model', '/tmp/a $(touch bad).mod', '--data', '/tmp/b b.dat', '--check', '--tmlim', '25'
  ]);
});

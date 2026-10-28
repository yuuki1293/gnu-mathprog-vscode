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

test('declarations attach consecutive line comments to all supported symbol kinds', () => {
  const kinds = ['set I', 'param c', 'var x', 'minimize Cost: x', 'maximize Profit: x', 'subject to Limit: x <= 1', 's.t. Other: x >= 0'];
  for (const declaration of kinds) {
    const text = `# 説明の1行目\n  # 説明の2行目\n  ${declaration};`;
    const [symbol] = declarations(text);
    assert.equal(symbol.comment, '説明の1行目\n説明の2行目');
    assert.equal(symbol.detail, `${declaration};`);
    assert.equal(text.slice(symbol.offset, symbol.offset + symbol.name.length), symbol.name);
  }
});

test('block comments preserve content and normalize CRLF and decorative stars', () => {
  const [symbol] = declarations('/**\r\n * 生産数量\r\n * 単位: 個\r\n *\r\n * 注記\r\n */\r\nvar x >= 0;');
  assert.equal(symbol.comment, '生産数量\n単位: 個\n\n注記');
  assert.equal(declarations('/*\n    費用\n    単位: 円\n*/\nparam c;')[0].comment, '費用\n単位: 円');
});

test('blank lines, intervening statements, and trailing comments stop attachment', () => {
  for (const text of ['# unrelated\n\nvar x;', '/* unrelated */\r\n \t\r\nvar x;', 'param c; # describes c\nvar x;', 'param c; /* describes c */\nvar x;']) {
    assert.equal(declarations(text).find(s => s.name === 'x').comment, '');
  }
  const symbols = declarations('# describes c\nparam c;\nvar x;');
  assert.equal(symbols[0].comment, 'describes c');
  assert.equal(symbols[1].comment, '');
  assert.equal(declarations('# old\n\n# current\nvar x;')[0].comment, 'current');
});

test('mixed comments are joined, while comment markers inside strings are ignored', () => {
  const text = 'param s symbolic := "/* fake */ # fake";\n# 1行目\n/* 2行目 */ /* 3行目 */\nvar x;';
  const symbols = declarations(text);
  assert.equal(symbols[0].comment, '');
  assert.equal(symbols[1].comment, '1行目\n2行目\n3行目');
  assert.equal(declarations("param s symbolic := '# fake';\nvar x;")[1].comment, '');
});

test('empty and absent comments do not add documentation', () => {
  for (const text of ['var x;', '/**/\nvar x;', '#\nvar x;', '/*\n *\n */\nvar x;']) {
    assert.equal(declarations(text)[0].comment, '');
  }
});

'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { tokenize, indexProject, symbolAt, renameEdits } = require('../src/refactoring');
const model = text => ({ id: 'm', role: 'model', text });
const data = (id, text) => ({ id, role: 'data', text });
function renamed(files, name, newName) {
  const index = indexProject(files);
  const edits = renameEdits(index, index.symbols.get(name), newName);
  return Object.fromEntries(files.map(file => {
    let text = file.text;
    for (const edit of edits.filter(edit => edit.file === file.id).sort((a,b) => b.start - a.start || b.end - a.end))
      text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
    return [file.id, text];
  }));
}

test('rename changes whole symbol references and leaves comments, strings, numbers and longer names intact', () => {
  const text = '# x\r\nvar x >= 0; var x1; minimize Cost: 1e3*x + x1; solve; printf "x = %g", x; /* x */';
  const out = renamed([model(text)], 'x', 'quantity').m;
  assert.equal(out, '# x\r\nvar quantity >= 0; var x1; minimize Cost: 1e3*quantity + x1; solve; printf "x = %g", quantity; /* x */');
  assert.ok(!tokenize('1.2e-3 1..5').some(t => t.kind === 'id'));
});

test('parameters rename model, inline data, and all external data headers without changing symbolic values', () => {
  const files = [model('set P; param cost{P}; param hours{P}; var x{P}; minimize Cost: sum{i in P} cost[i]*x[i]; data; param cost := cost 2; end;'),
    data('d1','data; set P := cost chair; param cost := cost 2 chair 3; end;'),
    data('d2','param : cost hours := cost 2 1 chair 3 2;')];
  const out = renamed(files, 'cost', 'price');
  assert.ok(out.m.includes('param price{P}') && out.m.includes('price[i]') && out.m.includes('param price := cost 2'));
  assert.equal(out.d1, 'data; set P := cost chair; param price := cost 2 chair 3; end;');
  assert.equal(out.d2, 'param : price hours := cost 2 1 chair 3 2;');
});

test('set names in ordinary and tabbing data headers are distinguished from labels', () => {
  const out = renamed([model('set PRODUCTS; param cost{PRODUCTS};'),
    data('d', 'set PRODUCTS := PRODUCTS chair; param : PRODUCTS : cost := PRODUCTS 1 chair 2;')], 'PRODUCTS', 'ITEMS');
  assert.equal(out.d, 'set ITEMS := PRODUCTS chair; param : ITEMS : cost := PRODUCTS 1 chair 2;');
});

test('default values and matrix row/column labels in data are not references', () => {
  const out = renamed([model('set P; param cost{P,P};'), data('d', 'param cost default cost : cost chair := cost 1 2 chair 3 4;')], 'cost', 'price');
  assert.equal(out.d, 'param price default cost : cost chair := cost 1 2 chair 3 4;');
  const tab = renamed([model('set P; param cost{P};'), data('d', 'param default cost : cost := cost 1;')], 'cost', 'price');
  assert.equal(tab.d, 'param default cost : price := cost 1;');
});

test('dummy indices used before a later global declaration are not renamed', () => {
  const text = 'set I := 1..2; param total := sum{x in I} x; var x >= 0; minimize Cost: x + total;';
  const out = renamed([model(text)], 'x', 'quantity').m;
  assert.ok(out.includes('sum{x in I} x; var quantity'));
  assert.ok(out.includes('Cost: quantity + total'));
  const index = indexProject([model(text)]);
  assert.equal(symbolAt(index, 'm', text.indexOf('x in')), undefined);
});

test('new names cannot capture dummy indices, other declarations, or data headers', () => {
  const index = indexProject([model('set I; param cost{I}; var x{I}; minimize C: sum{i in I} cost[i]*x[i];'), data('d', 'param orphan := 1;')]);
  for (const name of ['i','I','orphan','sum','subject','bad-name','9name','x'.repeat(101)])
    assert.throws(() => renameEdits(index, index.symbols.get('cost'), name));
  assert.deepEqual(renameEdits(index, index.symbols.get('cost'), 'cost'), []);
});

test('table field aliases, table labels, and suffixes are not model references', () => {
  const text = 'set P; param cost{P}; param val; table cost IN "CSV" "in.csv": P <- [cost], cost ~ cost; var x{P}; solve; table output{i in P} OUT "CSV" "out.csv": x[i].val ~ cost, val ~ val;';
  const out = renamed([model(text)], 'cost', 'price').m;
  assert.ok(out.includes('table cost IN "CSV" "in.csv": P <- [cost], price ~ cost'));
  assert.ok(out.includes('x[i].val ~ cost'));
  const val = renamed([model(text)], 'val', 'value').m;
  assert.ok(val.includes('x[i].val ~ cost, value ~ val'));
});

test('implicit input/output table field names become explicit aliases to preserve CSV schemas', () => {
  const text = 'set P; param cost{P}; table input IN "CSV" "in.csv": P <- [ID], cost; solve; table output{i in P} OUT "CSV" "out.csv": cost[i], cost[i] * 2 ~ doubled;';
  const out = renamed([model(text)], 'cost', 'price').m;
  assert.ok(out.includes('[ID], price ~ cost;'));
  assert.ok(out.includes(': price[i] ~ cost, price[i] * 2 ~ doubled;'));
});

test('definitions after loop blocks and shorthand constraints are indexed', () => {
  const text = 'set I; for {i in I} { printf "%g", i; } var x; Capacity: x <= 2; subj to Lower: x >= 0; s.t. Upper: x <= 1;';
  const index = indexProject([model(text)]);
  assert.deepEqual([...index.symbols.keys()], ['I','x','Capacity','Lower','Upper']);
  assert.equal(renamed([model(text)], 'x', 'quantity').m.match(/quantity/g).length, 4);
});

test('standalone data files rename only set/parameter header symbols', () => {
  const file = data('d', '# cost\nparam cost := cost 2; param : cost other := cost 3 4;');
  const out = renamed([file], 'cost', 'price').d;
  assert.equal(out, '# cost\nparam price := cost 2; param : price other := cost 3 4;');
  const index = indexProject([file]);
  assert.equal(symbolAt(index,'d',file.text.indexOf(':= cost') + 3), undefined);
});

test('incomplete, duplicate, or malformed sources are rejected before proposing edits', () => {
  for (const text of ['var x', 'var x; var x;', 'var x{I;', 'var x; /* missing', 'param s := "missing;'])
    assert.throws(() => indexProject([model(text)]));
  assert.throws(() => indexProject([data('d', 'unknown x;')]));
});

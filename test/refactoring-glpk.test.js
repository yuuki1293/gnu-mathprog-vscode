'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { indexProject, renameEdits } = require('../src/refactoring');
const { runSolver } = require('../src/solver');
const { solverArgs } = require('../src/language');
const executable = process.env.MATHPROG_TEST_GLPSOL;
const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
async function applyRename(files, name, replacement) {
  const index = indexProject(files);
  const edits = renameEdits(index, index.symbols.get(name), replacement);
  for (const file of files) {
    for (const edit of edits.filter(edit => edit.file === file.id).sort((a,b) => b.start-a.start || b.end-a.end))
      file.text = file.text.slice(0,edit.start) + edit.text + file.text.slice(edit.end);
    await fs.writeFile(file.id, file.text);
  }
}
async function run(model, data) {
  return runSolver(executable, solverArgs(model, data, false, 5), { cwd: path.dirname(model), timeoutMs:10000 }, token, () => {});
}

test('GLPK produces the same solution after renaming model and tabbing-data parameter headers', { skip: !executable }, async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'mathprog rename '));
  try {
    const files = [{ id: path.join(folder,'model.mod'),role:'model',text:'set P; param cost{P}; param hours{P}; var x{P} >= 0; maximize Profit: sum{i in P} cost[i]*x[i]; Capacity: sum{i in P} hours[i]*x[i] <= 10; solve; display Profit; end;'},
      {id:path.join(folder,'sets.dat'),role:'data',text:'set P := cost chair;'},
      {id:path.join(folder,'values.dat'),role:'data',text:'param : cost hours := cost 5 1 chair 7 2;'}];
    for (const file of files) await fs.writeFile(file.id,file.text);
    const before = await run(files[0].id,files.slice(1).map(f=>f.id));
    assert.equal(before.code,0); assert.match(before.output,/Profit\.val = 50/);
    await applyRename(files,'cost','price');
    const after = await run(files[0].id,files.slice(1).map(f=>f.id));
    assert.equal(after.code,0); assert.match(after.output,/Profit\.val = 50/);
    assert.match(files[2].text,/price hours := cost 5/);
  } finally { await fs.rm(folder,{recursive:true,force:true}); }
});

test('renaming table parameters preserves implicit CSV input and output column names', { skip: !executable }, async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'mathprog table rename '));
  try {
    await fs.writeFile(path.join(folder,'values.csv'),'ID,cost\ncost,5\nchair,7\n');
    const files = [{id:path.join(folder,'model.mod'),role:'model',text:'set P; param cost{P}; table input IN "CSV" "values.csv": P <- [ID], cost; var x{P} >= 0; maximize Profit: sum{i in P} cost[i]*x[i]; Capacity: sum{i in P} x[i] <= 2; solve; display Profit; table result{i in P} OUT "CSV" "result.csv": cost[i]; end;'}];
    await fs.writeFile(files[0].id,files[0].text);
    const before=await run(files[0].id,[]); assert.equal(before.code,0); assert.match(before.output,/Profit\.val = 14/);
    const header=(await fs.readFile(path.join(folder,'result.csv'),'utf8')).split(/\r?\n/)[0];
    await applyRename(files,'cost','price');
    const after=await run(files[0].id,[]); assert.equal(after.code,0); assert.match(after.output,/Profit\.val = 14/);
    assert.equal((await fs.readFile(path.join(folder,'result.csv'),'utf8')).split(/\r?\n/)[0],header);
  } finally { await fs.rm(folder,{recursive:true,force:true}); }
});

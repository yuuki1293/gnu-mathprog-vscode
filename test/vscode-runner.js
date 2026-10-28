'use strict';
const vscode = require('vscode');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
async function run() {
  const report = [];
  const folder = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const reportFile = path.resolve(folder, '../vscode-smoke-result.json');
  try {
    const ext = vscode.extensions.getExtension('mathprog-local.gnu-mathprog');
    assert.ok(ext); await ext.activate(); report.push('Extension activation');
    assert.equal(await vscode.commands.executeCommand('mathprog.toggleAnalysis'), false);
    report.push('Automatic analysis starts enabled and can be disabled');
    const uri = vscode.Uri.file(path.join(folder, 'production.mod'));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    assert.equal(doc.languageId, 'mathprog'); report.push('File association');
    const symbols = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', uri);
    assert.ok(symbols.some(s => s.name === 'quantity')); report.push('Document symbols');
    const use = doc.positionAt(doc.getText().indexOf('quantity[p]') + 2);
    const defs = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', uri, use);
    assert.ok(defs.length); assert.equal(defs[0].range.start.line, 5); report.push('Go to definition');
    const hovers = await vscode.commands.executeCommand('vscode.executeHoverProvider', uri, use);
    assert.ok(hovers.length); report.push('Hover');
    const completion = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', uri, use);
    assert.ok(completion.items.some(item => item.label === 'quantity')); report.push('Completion');
    const commentUri = vscode.Uri.file(path.join(folder, 'hover-comments.mod'));
    const commentText = '# 製品の集合\nset PRODUCTS;\n# 製品ごとの生産数量\n# 単位: 個\nvar quantity{PRODUCTS} >= 0;\n/**\n * 1個あたりの費用\n * [詳細](command:example)\n */\nparam cost{PRODUCTS} >= 0;\n# 古いコメント\n\nvar undocumented;\nminimize Total: sum {p in PRODUCTS} cost[p] * quantity[p];\n';
    await vscode.workspace.fs.writeFile(commentUri, Buffer.from(commentText));
    const commentDoc = await vscode.workspace.openTextDocument(commentUri);
    const hoverAt = async offset => {
      const result = await vscode.commands.executeCommand('vscode.executeHoverProvider', commentUri, commentDoc.positionAt(offset));
      assert.ok(result.length);
      return result.flatMap(hover => hover.contents);
    };
    const quantityHover = await hoverAt(commentText.lastIndexOf('quantity') + 2);
    assert.ok(quantityHover.some(c => c.value.includes('var quantity{PRODUCTS} >= 0;') && c.value.includes('製品ごとの生産数量') && c.value.includes('単位')));
    report.push('Variable hover includes definition and consecutive comments at reference');
    const declaredHover = await hoverAt(commentText.indexOf('quantity') + 2);
    assert.ok(declaredHover.some(c => c.value.includes('製品ごとの生産数量')));
    const setHover = await hoverAt(commentText.indexOf('PRODUCTS') + 2);
    assert.ok(setHover.some(c => c.value.includes('製品の集合')));
    report.push('Comments shown at variable and set declarations');
    const costHover = await hoverAt(commentText.lastIndexOf('cost') + 2);
    assert.ok(costHover.some(c => c.value.includes('param cost') && c.value.includes('1個あたりの費用')));
    report.push('Parameter hover includes multiline block comment');
    assert.ok(costHover.every(c => c.isTrusted !== true));
    assert.ok(costHover.some(c => c.value.includes('\\[詳細\\]')));
    report.push('Comment Markdown shown as literal text');
    const undocumented = await hoverAt(commentText.indexOf('undocumented') + 2);
    assert.ok(undocumented.some(c => c.value.includes('var undocumented;')));
    assert.ok(undocumented.every(c => !c.value.includes('古いコメント')));
    report.push('Blank line separates unrelated comments from hover');
    if (vscode.workspace.isTrusted) {
      const workspaceFolder = vscode.workspace.workspaceFolders[0];
      const launchUri = vscode.Uri.joinPath(workspaceFolder.uri, '.vscode', 'launch.json');
      await vscode.workspace.fs.writeFile(launchUri, Buffer.from('{\n // Keep this user comment.\n "version": "0.2.0",\n "configurations": [{"type":"node","request":"launch","name":"Existing Node","program":"app.js"}]\n}\n'));
      await new Promise(resolve => {
        const sub = vscode.workspace.onDidChangeConfiguration(e => {
          if (e.affectsConfiguration('launch')) { sub.dispose(); resolve(); }
        });
        setTimeout(() => { sub.dispose(); resolve(); }, 500);
      });
      const initial = { type: 'mathprog', request: 'launch', name: 'Inline production', model: '${workspaceFolder}/production.mod', data: [], cwd: '${workspaceFolder}' };
      assert.ok(await vscode.commands.executeCommand('mathprog.createConfiguration', initial));
      const launchText = fs.readFileSync(launchUri.fsPath, 'utf8');
      assert.ok(launchText.includes('Keep this user comment') && launchText.includes('Existing Node') && launchText.includes('Inline production'));
      report.push('Create launch.json configuration and preserve existing JSONC and other configurations');
      assert.ok(await vscode.commands.executeCommand('mathprog.check', 'Inline production'));
      assert.equal(vscode.languages.getDiagnostics(uri).length, 0);
      report.push('Check saved configuration through VS Code launch');
      assert.ok(await vscode.commands.executeCommand('mathprog.run', 'Inline production'));
      report.push('Run saved inline-data configuration');
      assert.ok(await vscode.commands.executeCommand('mathprog.run', uri, { groupId: 1 }));
      assert.ok(await vscode.commands.executeCommand('mathprog.check', uri, { groupId: 1 }));
      report.push('Editor title URI arguments use saved configuration for Run and Check');
      const makeFile = async (relative, text) => {
        const file = vscode.Uri.joinPath(workspaceFolder.uri, relative);
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(file.fsPath)));
        await vscode.workspace.fs.writeFile(file, Buffer.from(text)); return file;
      };
      const model = await makeFile('models/experiment.mod', 'set P;\nparam limit{P};\nvar x{P} >= 0;\nmaximize Profit: sum {i in P} x[i];\nsubject to Capacity{i in P}: x[i] <= limit[i];\nsolve;\nprintf "%g", Profit > "result.txt";\ndata;\nset P := inline;\nparam limit := inline 3;\nend;\n');
      const sets = await makeFile('inputs/products.dat', 'data;\nset P := a b;\nend;\n');
      const values = await makeFile('inputs/scenario.dat', 'data;\nparam limit := a 7 b 5;\nend;\n');
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(workspaceFolder.uri, 'results with spaces'));
      const scenario = { ...initial, name: 'Scenario A', model: '${workspaceFolder}/models/experiment.mod',
        data: ['${workspaceFolder}/inputs/products.dat', '${workspaceFolder}/inputs/scenario.dat'], cwd: '${workspaceFolder}/results with spaces' };
      assert.ok(await vscode.commands.executeCommand('mathprog.createConfiguration', scenario));
      const dataDoc = await vscode.workspace.openTextDocument(values);
      await vscode.window.showTextDocument(dataDoc);
      assert.equal(dataDoc.languageId, 'mathprog');
      const completion = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', values, new vscode.Position(1, 2));
      assert.ok(completion.items.some(item => item.label === 'param'));
      report.push('Data file language association and completion');
      const resultPath = path.join(folder, 'results with spaces/result.txt');
      assert.ok(await vscode.commands.executeCommand('mathprog.run', 'Scenario A'));
      assert.equal(fs.readFileSync(resultPath, 'utf8'), '12');
      assert.ok(!fs.existsSync(path.join(folder, 'result.txt')));
      report.push('Explicit model and two differently named data files run in configured working directory');
      const changeData = async text => {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(values, new vscode.Range(dataDoc.positionAt(0), dataDoc.positionAt(dataDoc.getText().length)), text);
        assert.ok(await vscode.workspace.applyEdit(edit));
      };
      await changeData('data;\nparam limit := a oops b 5;\nend;\n');
      assert.ok(await vscode.commands.executeCommand('mathprog.check', 'Scenario A'));
      assert.ok(vscode.languages.getDiagnostics(values).some(d => d.range.start.line === 1 && d.source === 'glpsol'));
      report.push('Diagnostics for second data file in configuration');
      await changeData('data;\nparam limit := a 10 b 5;\nend;\n');
      assert.ok(dataDoc.isDirty);
      assert.ok(await vscode.commands.executeCommand('mathprog.run', 'Scenario A'));
      assert.equal(dataDoc.isDirty, false); assert.equal(fs.readFileSync(resultPath, 'utf8'), '15');
      assert.equal(vscode.languages.getDiagnostics(values).length, 0);
      report.push('Save changed configured inputs and clear corrected diagnostics');
      const inline = { ...scenario, name: 'Inline experiment', data: [] };
      assert.ok(await vscode.commands.executeCommand('mathprog.createConfiguration', inline));
      await vscode.window.showTextDocument(dataDoc);
      assert.equal(await vscode.commands.executeCommand('mathprog.selectConfiguration', 'Inline experiment'), 'Inline experiment');
      assert.ok(await vscode.commands.executeCommand('mathprog.run'));
      assert.equal(fs.readFileSync(resultPath, 'utf8'), '3');
      report.push('Selected configuration is used regardless of active data filename');
      fs.unlinkSync(resultPath);
      assert.ok(await vscode.commands.executeCommand('mathprog.check', 'Scenario A'));
      assert.ok(!fs.existsSync(resultPath));
      report.push('Configuration check generates model without solving');
      const nativeRun = async (name, started) => {
        let done, timer;
        const completion = new Promise(resolve => { done = resolve; });
        const sub = vscode.debug.onDidTerminateDebugSession(session => { if (session.name === name) done(); });
        try {
          assert.ok(await vscode.debug.startDebugging(workspaceFolder, name, { noDebug: true }));
          if (started) await started();
          await Promise.race([completion, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Native launch did not terminate')), 10000); })]);
        } finally { sub.dispose(); clearTimeout(timer); }
      };
      await nativeRun('Scenario A');
      assert.equal(fs.readFileSync(resultPath, 'utf8'), '15');
      report.push('Native Run and Debug launch of named launch.json configuration');
      if (process.platform !== 'win32') {
        const fake = await makeFile('fake-glpsol', '#!/bin/sh\nprintf ready > ready.txt\nexec sleep 30\n');
        fs.chmodSync(fake.fsPath, 0o755);
        const slow = { ...scenario, name: 'Stop test', glpsolPath: fake.fsPath };
        assert.ok(await vscode.commands.executeCommand('mathprog.createConfiguration', slow));
        const ready = path.join(folder, 'results with spaces/ready.txt');
        if (fs.existsSync(ready)) fs.unlinkSync(ready);
        await nativeRun('Stop test', async () => {
          const deadline = Date.now() + 5000;
          while (!fs.existsSync(ready) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
          assert.ok(fs.existsSync(ready));
          assert.ok(vscode.debug.activeDebugSession?.name === 'Stop test');
          await vscode.debug.stopDebugging(vscode.debug.activeDebugSession);
        });
        assert.ok(await vscode.commands.executeCommand('mathprog.run', 'Scenario A'));
        assert.equal(fs.readFileSync(resultPath, 'utf8'), '15');
        report.push('Native Stop terminates running solver and allows next run');
      }
      const launchConfiguration = vscode.workspace.getConfiguration('launch', workspaceFolder.uri);
      const configs = launchConfiguration.get('configurations');
      await launchConfiguration.update('configurations', [...configs, { ...initial, name: 'Missing input', model: '${workspaceFolder}/missing.mod' }], vscode.ConfigurationTarget.WorkspaceFolder);
      assert.equal(await vscode.debug.startDebugging(workspaceFolder, 'Missing input', { noDebug: true }), false);
      report.push('Missing configured input rejects launch before starting process');
      assert.equal(await vscode.commands.executeCommand('mathprog.createConfiguration', scenario), false);
      assert.equal(vscode.workspace.getConfiguration('launch', workspaceFolder.uri).get('configurations').filter(c => c.name === 'Scenario A').length, 1);
      report.push('Duplicate creation preserves existing configuration');
      const waitFor = async (predicate, description) => {
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline) {
          if (predicate()) return;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        throw new Error(`Automatic analysis: ${description}`);
      };
      const autoModel = await makeFile('models/automatic.mod', fs.readFileSync(model.fsPath, 'utf8')
        .replace('solve;\n', 'printf "%g", sum {i in P} limit[i] > "analysis-result.txt";\nsolve;\n'));
      const autoConfig = { ...scenario, name: 'Automatic', model: '${workspaceFolder}/models/automatic.mod' };
      assert.ok(await vscode.commands.executeCommand('mathprog.createConfiguration', autoConfig));
      const marker = path.join(folder, 'results with spaces/analysis-result.txt');
      const markerValue = () => fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : undefined;
      if (fs.existsSync(marker)) fs.unlinkSync(marker);
      if (fs.existsSync(resultPath)) fs.unlinkSync(resultPath);
      await vscode.window.showTextDocument(dataDoc);
      assert.equal(await vscode.commands.executeCommand('mathprog.toggleAnalysis'), true);
      await waitFor(() => markerValue() === '15', 'enabling did not check selected configuration');
      assert.ok(!fs.existsSync(resultPath));
      assert.equal(vscode.debug.activeDebugSession, undefined);
      report.push('Enabling analysis checks saved configuration in background without solving or starting debug session');
      await changeData('data;\nparam limit := a oops b 5;\nend;\n');
      await dataDoc.save();
      await waitFor(() => vscode.languages.getDiagnostics(values).some(d => d.source === 'MathProg (auto)' && d.range.start.line === 1), 'saved data error was not diagnosed');
      report.push('Saving configured data automatically adds source errors to Problems');
      assert.equal(await vscode.commands.executeCommand('mathprog.toggleAnalysis', values, { groupId: 1 }), false);
      assert.ok(!vscode.languages.getDiagnostics(values).some(d => d.source === 'MathProg (auto)'));
      await changeData('data;\nparam limit := a 11 b 5;\nend;\n');
      await dataDoc.save(); await new Promise(resolve => setTimeout(resolve, 800));
      assert.equal(markerValue(), '15');
      report.push('Toolbar toggle disables analysis, clears its diagnostics, and prevents checking saves');
      assert.equal(await vscode.commands.executeCommand('mathprog.toggleAnalysis'), true);
      await waitFor(() => markerValue() === '16', 're-enabling did not check saved changes');
      assert.equal(vscode.languages.getDiagnostics(values).length, 0);
      report.push('Re-enabling immediately checks latest saved data and removes corrected errors');
      await changeData('data;\nparam limit := a 12 b 5;\nend;\n');
      await new Promise(resolve => setTimeout(resolve, 800));
      assert.equal(markerValue(), '16'); assert.equal(dataDoc.isDirty, true);
      await dataDoc.save(); await waitFor(() => markerValue() === '17', 'saving dirty input did not resume analysis');
      report.push('Automatic analysis waits for saving edits and never saves input itself');
      const autoInline = { ...autoConfig, name: 'Automatic inline', data: [] };
      assert.ok(await vscode.commands.executeCommand('mathprog.createConfiguration', autoInline));
      await waitFor(() => markerValue() === '3', 'configuration change did not switch analysis inputs');
      report.push('Changing selected configuration rechecks the new model and data combination');
      const launchSettings = vscode.workspace.getConfiguration('launch', workspaceFolder.uri);
      await launchSettings.update('configurations', launchSettings.get('configurations').filter(c => c.type !== 'mathprog'), vscode.ConfigurationTarget.WorkspaceFolder);
      await new Promise(resolve => setTimeout(resolve, 800));
      assert.equal(markerValue(), '3');
      assert.equal(vscode.workspace.getConfiguration('launch', workspaceFolder.uri).get('configurations').filter(c => c.type === 'mathprog').length, 0);
      assert.equal(vscode.debug.activeDebugSession, undefined);
      report.push('No configuration means no background process or configuration creation prompt');
      assert.equal(await vscode.commands.executeCommand('mathprog.toggleAnalysis'), false);

    } else report.push('Execution skipped: untrusted workspace');
    fs.writeFileSync(reportFile, JSON.stringify({ passed: true, checks: report }, null, 2));
  } catch (error) {
    fs.writeFileSync(reportFile, JSON.stringify({ passed: false, checks: report, error: error.stack }, null, 2));
    throw error;
  }
}
module.exports = { run };

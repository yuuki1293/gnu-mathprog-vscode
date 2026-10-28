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
    if (vscode.workspace.isTrusted) {
      await vscode.commands.executeCommand('mathprog.check');
      assert.equal(vscode.languages.getDiagnostics(uri).length, 0); report.push('Model check command');
      await vscode.commands.executeCommand('mathprog.run'); report.push('Run command');
      const broken = vscode.Uri.file(path.join(folder, 'broken.mod'));
      await vscode.workspace.fs.writeFile(broken, Buffer.from('var x >= 0;\nminimize Cost x;\nend;\n'));
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(broken));
      await vscode.commands.executeCommand('mathprog.check');
      const diagnostics = vscode.languages.getDiagnostics(broken);
      assert.ok(diagnostics.some(d => d.range.start.line === 1 && d.source === 'glpsol')); report.push('Problems diagnostics');
    } else report.push('Execution skipped: untrusted workspace');
    fs.writeFileSync(reportFile, JSON.stringify({ passed: true, checks: report }, null, 2));
  } catch (error) {
    fs.writeFileSync(reportFile, JSON.stringify({ passed: false, checks: report, error: error.stack }, null, 2));
    throw error;
  }
}
module.exports = { run };

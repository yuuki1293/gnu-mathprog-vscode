'use strict';
const vscode = require('vscode');
const path = require('node:path');
const { help, keywords, mask, declarations, parseDiagnostics, solverArgs } = require('./language');
const { runSolver } = require('./solver');

function activate(context) {
  const selector = { language: 'mathprog' };
  const output = vscode.window.createOutputChannel('GNU MathProg');
  const diagnostics = vscode.languages.createDiagnosticCollection('mathprog');
  let busy = false;
  let activeCancellation;
  const diagnosticFiles = new Map();
  const dataKey = uri => `data:${uri.toString()}`;
  const modelKey = uri => `model:${uri.toString()}`;
  const isData = doc => /\.dat$/i.test(doc.fileName);
  const symbolKind = kind => kind === 'set' ? vscode.SymbolKind.Array : kind === 'param' ? vscode.SymbolKind.Constant : kind === 'var' ? vscode.SymbolKind.Variable : vscode.SymbolKind.Function;
  const isCode = (doc, position) => {
    const prefix = doc.getText().slice(0, doc.offsetAt(position));
    return mask(prefix + 'X').endsWith('X');
  };
  context.subscriptions.push(output, diagnostics, { dispose: () => activeCancellation?.cancel() });
  context.subscriptions.push(vscode.languages.registerCompletionItemProvider(selector, {
    provideCompletionItems(doc, position) {
      if (!isCode(doc, position)) return [];
      const items = keywords.map(word => {
        const item = new vscode.CompletionItem(word, vscode.CompletionItemKind.Keyword);
        item.documentation = help[word] || `MathProg: ${word}`;
        return item;
      });
      for (const symbol of declarations(doc.getText())) {
        const item = new vscode.CompletionItem(symbol.name, vscode.CompletionItemKind.Variable);
        item.detail = symbol.detail; items.push(item);
      }
      return items;
    }
  }));
  context.subscriptions.push(vscode.languages.registerHoverProvider(selector, {
    provideHover(doc, position) {
      if (!isCode(doc, position)) return;
      const range = doc.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
      if (!range) return;
      const word = doc.getText(range);
      const symbol = declarations(doc.getText()).find(item => item.name === word);
      if (symbol) {
        const contents = new vscode.MarkdownString().appendCodeblock(symbol.detail, 'mathprog');
        if (symbol.comment) contents.appendMarkdown('\n\n---\n\n').appendText(symbol.comment);
        return new vscode.Hover(contents, range);
      }
      if (help[word]) return new vscode.Hover(help[word], range);
    }
  }));
  context.subscriptions.push(vscode.languages.registerDefinitionProvider(selector, {
    provideDefinition(doc, position) {
      if (!isCode(doc, position)) return;
      const range = doc.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
      if (!range) return;
      const symbol = declarations(doc.getText()).find(item => item.name === doc.getText(range));
      if (symbol) return new vscode.Location(doc.uri, new vscode.Range(doc.positionAt(symbol.offset), doc.positionAt(symbol.offset + symbol.name.length)));
    }
  }));
  context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider(selector, {
    provideDocumentSymbols(doc) {
      return declarations(doc.getText()).map(symbol => new vscode.DocumentSymbol(symbol.name, symbol.kind, symbolKind(symbol.kind),
        new vscode.Range(doc.positionAt(symbol.start), doc.positionAt(symbol.end)),
        new vscode.Range(doc.positionAt(symbol.offset), doc.positionAt(symbol.offset + symbol.name.length))));
    }
  }));

  function activeDocument() {
    const doc = vscode.window.activeTextEditor?.document;
    if (!doc || doc.languageId !== 'mathprog' || doc.uri.scheme !== 'file') {
      vscode.window.showWarningMessage('MathProg のモデルまたはデータファイルを開いてください。');
      return;
    }
    return doc;
  }
  function activeModel() {
    const doc = activeDocument();
    if (doc && isData(doc)) {
      vscode.window.showWarningMessage('モデルファイルを開いてください。データ側では「Select Model File for Data」でモデルを選択できます。');
      return;
    }
    return doc;
  }
  async function isModelFile(uri) {
    if (uri?.scheme !== 'file' || !/\.(mod|mpl|mathprog)$/i.test(uri.fsPath)) return false;
    try { return Boolean((await vscode.workspace.fs.stat(uri)).type & vscode.FileType.File); }
    catch (error) { if (error.code === 'FileNotFound') return false; throw error; }
  }
  async function selectModel(dataDoc, modelUri) {
    if (!modelUri) {
      const files = await vscode.window.showOpenDialog({ canSelectMany: false,
        defaultUri: vscode.Uri.file(path.dirname(dataDoc.fileName)),
        filters: { 'MathProg model': ['mod', 'mpl', 'mathprog'] },
        title: `${path.basename(dataDoc.fileName)} に使用するモデル` });
      modelUri = files?.[0];
    }
    if (!modelUri) return;
    if (!(await isModelFile(modelUri))) {
      vscode.window.showWarningMessage('既存のモデルファイル (.mod / .mpl / .mathprog) を選択してください。'); return;
    }
    await context.workspaceState.update(modelKey(dataDoc.uri), modelUri.fsPath);
    return vscode.workspace.openTextDocument(modelUri);
  }
  async function modelForData(dataDoc) {
    const remembered = context.workspaceState.get(modelKey(dataDoc.uri));
    if (remembered) {
      const uri = vscode.Uri.file(remembered);
      if (await isModelFile(uri)) return vscode.workspace.openTextDocument(uri);
    }
    const stem = dataDoc.fileName.replace(/\.dat$/i, '');
    const candidates = [];
    for (const extension of ['.mod', '.mpl', '.mathprog']) {
      const uri = vscode.Uri.file(stem + extension);
      if (await isModelFile(uri)) candidates.push(uri);
    }
    if (candidates.length === 1) return selectModel(dataDoc, candidates[0]);
    return selectModel(dataDoc);
  }
  async function execute(check) {
    if (!vscode.workspace.isTrusted) {
      vscode.window.showWarningMessage('GLPK の実行には、ワークスペースを信頼する必要があります。'); return;
    }
    if (busy) { vscode.window.showInformationMessage('MathProg は実行中です。通知のキャンセルから停止できます。'); return; }
    const active = activeDocument();
    if (!active) return;
    busy = true;
    try {
      const doc = isData(active) ? await modelForData(active) : active;
      if (!doc || !(await doc.save())) return;
      const data = isData(active) ? active.fileName : context.workspaceState.get(dataKey(doc.uri));
      const dataDoc = data && vscode.workspace.textDocuments.find(d => d.uri.fsPath === data);
      if (dataDoc?.isDirty && !(await dataDoc.save())) return;
      if (data) await vscode.workspace.fs.stat(vscode.Uri.file(data));
      const version = doc.version;
      const dataVersion = dataDoc?.version;
      const config = vscode.workspace.getConfiguration('mathprog', doc.uri);
      const executable = config.get('glpsolPath', 'glpsol');
      const limit = Math.max(1, Math.min(86400, config.get('timeLimit', 60)));
      const args = solverArgs(doc.fileName, data, check, limit);
      const cwd = path.dirname(doc.fileName);
      for (const uri of diagnosticFiles.get(doc.uri.toString()) || []) diagnostics.delete(uri);
      diagnosticFiles.delete(doc.uri.toString());
      output.clear(); output.show(true);
      output.appendLine(`${check ? 'Check' : 'Run'}: ${doc.fileName}`);
      if (data) output.appendLine(`Data: ${data}`);
      output.appendLine(`Executable: ${executable}\n`);
      const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: check ? 'MathProg: モデルを検査中' : 'MathProg: モデルを実行中', cancellable: true },
        async (_, token) => {
          const source = new vscode.CancellationTokenSource();
          activeCancellation = source;
          const sub = token.onCancellationRequested(() => source.cancel());
          if (token.isCancellationRequested) source.cancel();
          try { return await runSolver(executable, args, { cwd, timeoutMs: (limit + 5) * 1000 }, source.token, text => output.append(text)); }
          finally { sub.dispose(); source.dispose(); activeCancellation = undefined; }
        });
      if (result.cancelled) {
        output.appendLine(result.timedOut ? '\n制限時間を超えたため停止しました。' : '\nキャンセルしました。'); return;
      }
      if (doc.version === version && (!dataDoc || dataDoc.version === dataVersion)) {
        const groups = new Map();
        for (const item of parseDiagnostics(result.output, cwd)) {
          // Only model/data inputs are known to have been read by this invocation.
          if (item.file !== doc.fileName && item.file !== data) continue;
          const uri = vscode.Uri.file(item.file);
          const range = new vscode.Range(item.line, 0, item.line, 10000);
          const diagnostic = new vscode.Diagnostic(range, item.message, vscode.DiagnosticSeverity.Error);
          diagnostic.source = 'glpsol';
          if (!groups.has(item.file)) groups.set(item.file, { uri, items: [] });
          groups.get(item.file).items.push(diagnostic);
        }
        for (const { uri, items } of groups.values()) diagnostics.set(uri, items);
        diagnosticFiles.set(doc.uri.toString(), [...groups.values()].map(g => g.uri));
      }
      output.appendLine(`\nExit code: ${result.code}`);
      if (result.code !== 0) vscode.window.showErrorMessage('MathProg の処理に失敗しました。「GNU MathProg」の出力と「問題」を確認してください。');
      else vscode.window.showInformationMessage(check ? 'MathProg: モデルの検査が完了しました。' : 'MathProg: 実行が完了しました。解の状態は出力で確認してください。');
    } catch (error) {
      const message = error.code === 'ENOENT' ? 'glpsol が見つかりません。GLPK をインストールし、mathprog.glpsolPath を設定してください。' : `MathProg: ${error.message}`;
      output.appendLine(message); output.show(true); vscode.window.showErrorMessage(message);
    } finally { busy = false; }
  }
  const command = (id, fn) => context.subscriptions.push(vscode.commands.registerCommand(`mathprog.${id}`, fn));
  command('run', () => execute(false)); command('check', () => execute(true));
  command('showOutput', () => output.show());
  command('selectData', async () => {
    const doc = activeModel(); if (!doc) return;
    const files = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { 'MathProg data': ['dat'], 'All files': ['*'] }, title: 'モデルに使用するデータファイル' });
    if (files?.length) {
      await context.workspaceState.update(dataKey(doc.uri), files[0].fsPath);
      await context.workspaceState.update(modelKey(files[0]), doc.fileName);
      vscode.window.showInformationMessage(`データを選択しました: ${path.basename(files[0].fsPath)}`);
    }
  });
  command('selectModel', async modelUri => {
    const doc = activeDocument(); if (!doc) return;
    if (!isData(doc)) { vscode.window.showWarningMessage('.dat ファイルを開いてモデルを選択してください。'); return; }
    try {
      const model = await selectModel(doc, modelUri);
      if (model) vscode.window.showInformationMessage(`モデルを選択しました: ${path.basename(model.fileName)}`);
    } catch (error) { vscode.window.showErrorMessage(`MathProg: ${error.message}`); }
  });
  command('clearData', async () => {
    const doc = activeModel(); if (!doc) return;
    await context.workspaceState.update(dataKey(doc.uri), undefined);
    vscode.window.showInformationMessage('データファイルの選択を解除しました。');
  });
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => diagnostics.delete(event.document.uri)));
}
module.exports = { activate };

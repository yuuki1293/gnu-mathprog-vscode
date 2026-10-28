'use strict';
const vscode = require('vscode');
const path = require('node:path');
const { help, keywords, mask, declarations, parseDiagnostics, solverArgs } = require('./language');
const { runSolver } = require('./solver');
const { initialConfiguration, resolveRunConfiguration, workspacePath } = require('./configuration');
const { RunDebugAdapter } = require('./debugAdapter');
const { registerAutomaticAnalysis } = require('./automaticAnalysis');

function activate(context) {
  const selector = { language: 'mathprog' };
  const output = vscode.window.createOutputChannel('GNU MathProg');
  const diagnostics = vscode.languages.createDiagnosticCollection('mathprog');
  let busy = false;
  let automatic;
  const activeCancellations = new Set();
  const symbolKind = kind => kind === 'set' ? vscode.SymbolKind.Array : kind === 'param' ? vscode.SymbolKind.Constant : kind === 'var' ? vscode.SymbolKind.Variable : vscode.SymbolKind.Function;
  const isCode = (doc, position) => {
    const prefix = doc.getText().slice(0, doc.offsetAt(position));
    return mask(prefix + 'X').endsWith('X');
  };
  context.subscriptions.push(output, diagnostics, { dispose: () => { for (const source of activeCancellations) source.cancel(); } });
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

  const configurationKey = entry => `${entry.folder.uri.toString()}#${entry.config.name}`;
  function entries() {
    return (vscode.workspace.workspaceFolders || []).filter(folder => folder.uri.scheme === 'file').flatMap(folder => {
      const configs = vscode.workspace.getConfiguration('launch', folder.uri).get('configurations', []);
      return Array.isArray(configs) ? configs.filter(config => config?.type === 'mathprog' && config.request === 'launch')
        .map(config => ({ folder, config })) : [];
    });
  }
  function selectedEntry() {
    const available = entries();
    return available.find(entry => configurationKey(entry) === context.workspaceState.get('selectedConfiguration'))
      || (available.length === 1 ? available[0] : undefined);
  }
  async function chooseConfiguration(name, forcePick = false) {
    const available = entries();
    let candidates = name ? available.filter(entry => entry.config.name === name || configurationKey(entry) === name) : available;
    if (!candidates.length) {
      if (name) throw new Error(`実行構成が見つかりません: ${name}`);
      await createConfiguration();
      return;
    }
    let selected;
    if (!name && !forcePick) {
      const key = context.workspaceState.get('selectedConfiguration');
      selected = candidates.find(entry => configurationKey(entry) === key);
    }
    if (!selected && candidates.length === 1 && !forcePick) selected = candidates[0];
    if (!selected) {
      const pick = await vscode.window.showQuickPick(candidates.map(entry => ({
        label: entry.config.name, description: entry.folder.name, detail: entry.config.model, entry
      })), { title: 'MathProg の実行構成', placeHolder: '実行するモデルとデータの組み合わせを選択' });
      selected = pick?.entry;
    }
    if (selected) {
      await context.workspaceState.update('selectedConfiguration', configurationKey(selected));
      automatic?.schedule();
    }
    return selected;
  }
  async function configurationFolder() {
    const folders = (vscode.workspace.workspaceFolders || []).filter(folder => folder.uri.scheme === 'file');
    if (!folders.length) {
      const selected = await vscode.window.showOpenDialog({ canSelectMany: false, canSelectFiles: false,
        canSelectFolders: true, title: '実行構成を保存するフォルダーを選択' });
      if (!selected?.length) return;
      await context.globalState.update('pendingCreateConfiguration', { folder: selected[0].toString(), requestedAt: Date.now() });
      try { await vscode.commands.executeCommand('vscode.openFolder', selected[0], { forceNewWindow: false }); }
      catch (error) { await context.globalState.update('pendingCreateConfiguration', undefined); throw error; }
      return;
    }
    const active = vscode.window.activeTextEditor?.document.uri;
    const folder = active && vscode.workspace.getWorkspaceFolder(active);
    if (folder?.uri.scheme === 'file') return folder;
    if (folders.length === 1) return folders[0];
    return (await vscode.window.showQuickPick(folders.map(folder => ({ label: folder.name, folder })),
      { title: '実行構成を保存するフォルダー' }))?.folder;
  }
  async function createConfiguration(draft) {
    const folder = await configurationFolder(); if (!folder) return;
    const launch = vscode.workspace.getConfiguration('launch', folder.uri);
    const existing = launch.get('configurations', []);
    if (!draft) {
      const model = (await vscode.window.showOpenDialog({ canSelectMany: false,
        defaultUri: folder.uri, filters: { 'MathProg model': ['mod', 'mpl', 'mathprog'] }, title: '実行するモデルを選択' }))?.[0];
      if (!model) return;
      const mode = await vscode.window.showQuickPick(['モデル内のデータを使う', '外部のデータファイルを使う'], { title: 'データの指定' });
      if (!mode) return;
      let data = [];
      if (mode === '外部のデータファイルを使う') {
        const files = await vscode.window.showOpenDialog({ canSelectMany: true, defaultUri: folder.uri,
          filters: { 'MathProg data': ['dat'], 'All files': ['*'] }, title: 'データファイルを選択（最大10件）' });
        if (!files?.length) return;
        data = files.map(uri => workspacePath(folder.uri.fsPath, uri.fsPath));
      }
      const name = await vscode.window.showInputBox({ title: '実行構成の名前', value: path.basename(model.fsPath, path.extname(model.fsPath)),
        validateInput: value => !value.trim() ? '名前を入力してください。' : existing.some(c => c.name === value.trim()) ? '別の名前を指定してください。' : undefined });
      if (!name) return;
      draft = { ...initialConfiguration, name: name.trim(), model: workspacePath(folder.uri.fsPath, model.fsPath), data };
    }
    if (existing.some(config => config.name === draft.name)) throw new Error(`同名の実行構成があります: ${draft.name}`);
    // Validate structure without evaluating variable expressions or executing anything.
    resolveRunConfiguration({ ...draft, model: draft.model?.replace(/\$\{workspaceFolder\}/g, folder.uri.fsPath),
      data: Array.isArray(draft.data) ? draft.data.map(file => typeof file === 'string' ? file.replace(/\$\{workspaceFolder\}/g, folder.uri.fsPath) : file) : draft.data,
      cwd: draft.cwd?.replace(/\$\{workspaceFolder\}/g, folder.uri.fsPath) }, folder.uri.fsPath);
    const launchUri = vscode.Uri.joinPath(folder.uri, '.vscode', 'launch.json');
    const openLaunch = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === launchUri.toString());
    if (openLaunch?.isDirty) throw new Error('編集中の launch.json を保存してから実行構成を追加してください。');
    if (!launch.get('version')) await launch.update('version', '0.2.0', vscode.ConfigurationTarget.WorkspaceFolder);
    await launch.update('configurations', [...existing, draft], vscode.ConfigurationTarget.WorkspaceFolder);
    await context.workspaceState.update('selectedConfiguration', configurationKey({ folder, config: draft }));
    automatic?.schedule();
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(launchUri));
    return draft;
  }
  async function validateFiles(config) {
    for (const file of [config.model, ...config.data]) {
      let stat;
      try { stat = await vscode.workspace.fs.stat(vscode.Uri.file(file)); }
      catch { throw new Error(`入力ファイルが見つかりません: ${file}`); }
      if (!(stat.type & vscode.FileType.File)) throw new Error(`ファイルを指定してください: ${file}`);
    }
    let stat;
    try { stat = await vscode.workspace.fs.stat(vscode.Uri.file(config.cwd)); }
    catch { throw new Error(`作業フォルダーが見つかりません: ${config.cwd}`); }
    if (!(stat.type & vscode.FileType.Directory)) throw new Error(`cwd にフォルダーを指定してください: ${config.cwd}`);
  }
  async function execute(raw, folder, token, stream) {
    if (!vscode.workspace.isTrusted) throw new Error('GLPK の実行には、ワークスペースを信頼する必要があります。');
    if (busy) throw new Error('MathProg は実行中です。停止してから別の構成を実行してください。');
    busy = true;
    try {
      await automatic?.pause();
      const defaults = vscode.workspace.getConfiguration('mathprog', folder.uri);
      const config = resolveRunConfiguration(raw, folder.uri.fsPath, { glpsolPath: defaults.get('glpsolPath'), timeLimit: defaults.get('timeLimit') });
      await validateFiles(config);
      const docs = [];
      for (const file of [config.model, ...config.data]) {
        if (token.isCancellationRequested) return { cancelled: true };
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
        if (doc.isDirty && !(await doc.save())) return { cancelled: true };
        docs.push({ doc, version: doc.version });
      }
      diagnostics.clear(); output.clear(); output.show(true);
      const append = text => { output.append(text); stream(text); };
      append(`Configuration: ${config.name}\n${config.action === 'check' ? 'Check' : 'Run'}: ${config.model}\n`);
      for (const file of config.data) append(`Data: ${file}\n`);
      append(`Working directory: ${config.cwd}\nExecutable: ${config.glpsolPath}\n\n`);
      if (token.isCancellationRequested) return { cancelled: true };
      const result = await runSolver(config.glpsolPath, solverArgs(config.model, config.data, config.action === 'check', config.timeLimit),
        { cwd: config.cwd, timeoutMs: (config.timeLimit + 5) * 1000 }, token, append);
      if (result.cancelled) {
        append(result.timedOut ? '\n制限時間を超えたため停止しました。\n' : '\nキャンセルしました。\n'); return result;
      }
      if (docs.every(({ doc, version }) => doc.version === version)) {
        const inputs = new Set([config.model, ...config.data]);
        const groups = new Map();
        for (const item of parseDiagnostics(result.output, config.cwd)) {
          if (!inputs.has(item.file)) continue;
          const diagnostic = new vscode.Diagnostic(new vscode.Range(item.line, 0, item.line, 10000), item.message, vscode.DiagnosticSeverity.Error);
          diagnostic.source = 'glpsol';
          if (!groups.has(item.file)) groups.set(item.file, []);
          groups.get(item.file).push(diagnostic);
        }
        for (const [file, items] of groups) diagnostics.set(vscode.Uri.file(file), items);
      }
      append(`\nExit code: ${result.code}\n`);
      if (result.code !== 0) vscode.window.showErrorMessage('MathProg の処理に失敗しました。出力と「問題」を確認してください。');
      return result;
    } catch (error) {
      const message = error.code === 'ENOENT' ? 'glpsol が見つかりません。GLPK をインストールし、glpsolPath を設定してください。' : `MathProg: ${error.message}`;
      output.appendLine(message); output.show(true); vscode.window.showErrorMessage(message);
      throw new Error(message);
    } finally { busy = false; automatic?.resume(); }
  }
  const provider = {
    provideDebugConfigurations: () => [{ ...initialConfiguration, data: [] }],
    resolveDebugConfiguration(folder, config) {
      if (!vscode.workspace.isTrusted) { vscode.window.showWarningMessage('GLPK の実行には、ワークスペースを信頼する必要があります。'); return null; }
      if (!folder || folder.uri.scheme !== 'file') { vscode.window.showErrorMessage('実行構成を保存したフォルダーを開いてください。'); return null; }
      return config;
    },
    async resolveDebugConfigurationWithSubstitutedVariables(folder, raw) {
      try {
        const defaults = vscode.workspace.getConfiguration('mathprog', folder.uri);
        const resolved = resolveRunConfiguration(raw, folder.uri.fsPath, { glpsolPath: defaults.get('glpsolPath'), timeLimit: defaults.get('timeLimit') });
        await validateFiles(resolved);
        return { ...raw, ...resolved };
      } catch (error) { vscode.window.showErrorMessage(`MathProg: ${error.message}`); return null; }
    }
  };
  context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('mathprog', provider));
  context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('mathprog', {
    createDebugAdapterDescriptor(session) {
      const cancellation = new vscode.CancellationTokenSource();
      activeCancellations.add(cancellation);
      const adapter = new RunDebugAdapter((config, token, stream) => execute(config, session.workspaceFolder, token, stream),
        new vscode.EventEmitter(), cancellation);
      const dispose = adapter.dispose.bind(adapter);
      adapter.dispose = () => { activeCancellations.delete(cancellation); dispose(); };
      return new vscode.DebugAdapterInlineImplementation(adapter);
    }
  }));
  context.subscriptions.push(vscode.debug.onDidStartDebugSession(session => {
    if (session.type === 'mathprog' && session.workspaceFolder) {
      void context.workspaceState.update('selectedConfiguration', configurationKey({ folder: session.workspaceFolder, config: session.configuration }))
        .then(() => automatic?.schedule());
    }
  }));
  async function launch(check, name) {
    if (!vscode.workspace.isTrusted) { vscode.window.showWarningMessage('GLPK の実行には、ワークスペースを信頼する必要があります。'); return false; }
    if (busy) { vscode.window.showInformationMessage('MathProg は実行中です。停止してから実行してください。'); return false; }
    await automatic?.pause();
    try {
      const entry = await chooseConfiguration(name); if (!entry) return false;
      const runId = `${Date.now()}-${Math.random()}`;
      let done;
      const completion = new Promise(resolve => { done = resolve; });
      const sub = vscode.debug.onDidTerminateDebugSession(session => {
        if (session.configuration.__mathprogRunId === runId) done(true);
      });
      try {
        const started = await vscode.debug.startDebugging(entry.folder, { ...entry.config,
          action: check ? 'check' : entry.config.action || 'run', __mathprogRunId: runId }, { noDebug: true });
        if (!started) return false;
        return await completion;
      } finally { sub.dispose(); }
    } finally { automatic?.resume(); }
  }

  const command = (id, fn) => context.subscriptions.push(vscode.commands.registerCommand(`mathprog.${id}`, async (...args) => {
    try { return await fn(...args); }
    catch (error) { vscode.window.showErrorMessage(`MathProg: ${error.message}`); return false; }
  }));
  // Editor title buttons pass a resource URI; only strings explicitly select a configuration.
  command('run', argument => launch(false, typeof argument === 'string' ? argument : undefined));
  command('check', argument => launch(true, typeof argument === 'string' ? argument : undefined));
  command('showOutput', () => output.show());
  command('createConfiguration', draft => createConfiguration(draft));
  command('selectConfiguration', argument => {
    const name = typeof argument === 'string' ? argument : undefined;
    return chooseConfiguration(name, !name).then(entry => entry?.config.name);
  });
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => diagnostics.delete(event.document.uri)));
  automatic = registerAutomaticAnalysis(context, { getEntry: selectedEntry, entryCount: () => entries().length,
    validateFiles, clearManualDiagnostics: () => diagnostics.clear() });
  // Opening the first workspace restarts the extension host; continue the requested wizard there.
  const pending = context.globalState.get('pendingCreateConfiguration');
  if (pending) {
    const expired = Date.now() - pending.requestedAt > 5 * 60 * 1000;
    const matchingFolder = vscode.workspace.workspaceFolders?.some(folder => folder.uri.toString() === pending.folder);
    if (expired || matchingFolder) {
      void context.globalState.update('pendingCreateConfiguration', undefined)
        .then(() => { if (!expired) return createConfiguration(); })
        .catch(error => vscode.window.showErrorMessage(`MathProg: ${error.message}`));
    }
  }
}
module.exports = { activate };

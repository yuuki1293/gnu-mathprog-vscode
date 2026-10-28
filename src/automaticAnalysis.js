'use strict';
const vscode = require('vscode');
const { AnalysisScheduler } = require('./analysisScheduler');
const { resolveAnalysisConfiguration } = require('./configuration');
const { solverArgs, parseDiagnostics } = require('./language');
const { runSolver } = require('./solver');

function registerAutomaticAnalysis(context, { getEntry, entryCount, validateFiles, clearManualDiagnostics }) {
  const diagnostics = vscode.languages.createDiagnosticCollection('mathprog-auto');
  const output = vscode.window.createOutputChannel('GNU MathProg: Automatic Analysis');
  const button = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  button.command = 'mathprog.toggleAnalysis';
  button.name = 'MathProg Automatic Analysis';
  let detail = '';
  const enabled = context.workspaceState.get('analysisEnabled', true);
  const configurationFile = uri => /[\\/]\.vscode[\\/](launch|settings)\.json$/i.test(uri.fsPath);
  function configFor(entry) {
    const defaults = vscode.workspace.getConfiguration('mathprog', entry.folder.uri);
    return resolveAnalysisConfiguration(entry.config, entry.folder.uri.fsPath,
      { glpsolPath: defaults.get('glpsolPath'), timeLimit: defaults.get('timeLimit') },
      { file: vscode.window.activeTextEditor?.document.uri.scheme === 'file' ? vscode.window.activeTextEditor.document.uri.fsPath : undefined,
        env: process.env, folders: Object.fromEntries((vscode.workspace.workspaceFolders || []).map(folder => [folder.name, folder.uri.fsPath])) });
  }
  function relevant(uri) {
    if (uri.scheme !== 'file') return false;
    if (configurationFile(uri)) return true;
    const entry = getEntry();
    if (!entry) return false;
    try { const config = configFor(entry); return [config.model, ...config.data].includes(uri.fsPath); }
    catch { return /\.(mod|mpl|mathprog|dat)$/i.test(uri.fsPath); }
  }
  function status(state, message) {
    const labels = { off: 'オフ', waiting: 'オン', running: '解析中', paused: '一時停止', clean: '問題なし', errors: 'エラーあり',
      unconfigured: '構成なし', selection: '構成を選択', untrusted: '信頼待ち', dirty: '保存待ち', error: '設定を確認', timeout: '時間切れ' };
    const icon = state === 'off' ? 'circle-slash' : state === 'running' ? 'sync~spin' : ['error', 'errors', 'timeout'].includes(state) ? 'warning' : 'check-all';
    button.text = `$(${icon}) 自動解析: ${labels[state] || 'オン'}`;
    detail = message || '';
    button.tooltip = `MathProg 自動解析\n${detail || '選択した実行構成で保存済みのモデルとデータを検査します。'}\nクリックでオン・オフを切り替えます。\nログ: GNU MathProg: Automatic Analysis`;
    if (vscode.window.activeTextEditor?.document.languageId === 'mathprog' || entryCount()) button.show(); else button.hide();
  }
  async function analyze(token) {
    if (!vscode.workspace.isTrusted) return { state: 'untrusted' };
    const entry = getEntry();
    if (!entry) return { state: entryCount() ? 'selection' : 'unconfigured' };
    if (vscode.workspace.textDocuments.some(doc => doc.isDirty && configurationFile(doc.uri))) return { state: 'dirty', message: 'launch.json または設定を保存してください。' };
    const config = configFor(entry);
    await validateFiles(config);
    const inputs = [config.model, ...config.data];
    const snapshots = [];
    for (const file of inputs) {
      const doc = vscode.workspace.textDocuments.find(doc => doc.uri.fsPath === file);
      if (doc?.isDirty) return { state: 'dirty', message: '構成で指定したモデルとデータを保存してください。' };
      const stat = await vscode.workspace.fs.stat(vscode.Uri.file(file));
      snapshots.push({ file, doc, version: doc?.version, mtime: stat.mtime, size: stat.size });
    }
    if (token.isCancellationRequested) return;
    const settings = vscode.workspace.getConfiguration('mathprog', entry.folder.uri);
    const analysisLimit = settings.get('analysis.timeLimit', 10);
    if (!Number.isInteger(analysisLimit) || analysisLimit < 1 || analysisLimit > 300) throw new Error('mathprog.analysis.timeLimit は1〜300の整数にしてください。');
    const limit = Math.min(config.timeLimit, analysisLimit);
    const result = await runSolver(config.glpsolPath, solverArgs(config.model, config.data, true, limit),
      { cwd: config.cwd, timeoutMs: (limit + 5) * 1000 }, token, () => {});
    if (result.cancelled) return { state: result.timedOut ? 'timeout' : 'waiting', message: config.name };
    for (const snapshot of snapshots) {
      const doc = vscode.workspace.textDocuments.find(doc => doc.uri.fsPath === snapshot.file);
      const stat = await vscode.workspace.fs.stat(vscode.Uri.file(snapshot.file));
      if (doc?.isDirty || (snapshot.doc && snapshot.doc.version !== snapshot.version) || stat.mtime !== snapshot.mtime || stat.size !== snapshot.size) return;
    }
    const items = parseDiagnostics(result.output, config.cwd).filter(item => inputs.includes(item.file));
    return { state: items.length || result.code !== 0 ? 'errors' : 'clean', message: `${config.name}${items.length ? `: ${items.length}件` : ''}`,
      items, output: `Configuration: ${config.name}\nModel: ${config.model}\n${config.data.map(file => `Data: ${file}\n`).join('')}\n${result.output}\nExit code: ${result.code}\n` };
  }
  const scheduler = new AnalysisScheduler({ enabled, createCancellation: () => new vscode.CancellationTokenSource(), analyze,
    clear: () => diagnostics.clear(), status,
    publish(result) {
      if (!result) { status('dirty', '入力が変更されました。保存後に再解析します。'); return; }
      if (result.output) { clearManualDiagnostics(); output.clear(); output.append(result.output); }
      const groups = new Map();
      for (const item of result.items || []) {
        const diagnostic = new vscode.Diagnostic(new vscode.Range(item.line, 0, item.line, 10000), item.message, vscode.DiagnosticSeverity.Error);
        diagnostic.source = 'MathProg (auto)';
        if (!groups.has(item.file)) groups.set(item.file, []);
        groups.get(item.file).push(diagnostic);
      }
      for (const [file, items] of groups) diagnostics.set(vscode.Uri.file(file), items);
      status(result.state, result.message);
    }
  });
  const previousStatus = scheduler.status;
  scheduler.status = (state, message) => {
    if (state === 'error') { output.clear(); output.appendLine(message); }
    previousStatus(state, message);
  };
  context.subscriptions.push(diagnostics, output, button, scheduler,
    vscode.workspace.onDidSaveTextDocument(doc => { if (relevant(doc.uri)) scheduler.schedule(); }),
    vscode.workspace.onDidOpenTextDocument(doc => { if (relevant(doc.uri)) scheduler.schedule(); }),
    vscode.workspace.onDidChangeTextDocument(event => { if (relevant(event.document.uri)) scheduler.invalidate('dirty'); }),
    vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('launch') || event.affectsConfiguration('mathprog')) scheduler.schedule(); }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => scheduler.schedule()),
    vscode.workspace.onDidGrantWorkspaceTrust(() => scheduler.schedule()),
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (editor?.document.languageId === 'mathprog') scheduler.schedule();
      else { if (entryCount()) button.show(); else button.hide(); }
    }),
    vscode.commands.registerCommand('mathprog.toggleAnalysis', async () => {
      const value = !scheduler.enabled;
      scheduler.setEnabled(value);
      await context.workspaceState.update('analysisEnabled', value);
      return value;
    }),
    vscode.commands.registerCommand('mathprog.showAnalysisOutput', () => output.show()));
  scheduler.schedule();
  return scheduler;
}
module.exports = { registerAutomaticAnalysis };

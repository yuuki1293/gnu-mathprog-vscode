'use strict';
const vscode = require('vscode');
const { resolveAnalysisConfiguration } = require('./configuration');
const { indexProject, symbolAt, renameEdits } = require('./refactoring');

function registerRefactoring(context, { getEntries, getSelectedEntry }) {
  const choices = new Map();
  const identity = entry => `${entry.folder.uri.toString()}#${entry.config.name}`;
  function filesFor(entry, onlyModel = false) {
    // Refactoring depends only on fixed model/data paths, never solver executables or tasks.
    const resolved = resolveAnalysisConfiguration({ ...entry.config, name: 'Refactoring', data: onlyModel ? [] : entry.config.data,
      cwd: entry.folder.uri.fsPath, glpsolPath: 'glpsol', timeLimit: 60 }, entry.folder.uri.fsPath, {},
      { env: process.env, folders: Object.fromEntries((vscode.workspace.workspaceFolders || []).map(folder => [folder.name, folder.uri.fsPath])) });
    return { entry, model: resolved.model, data: resolved.data };
  }
  async function projectFor(doc, token) {
    const local = () => ({ files: [{ id: doc.uri.toString(), doc, version: doc.version, text: doc.getText(), role: /\.dat$/i.test(doc.fileName) ? 'data' : 'model' }], shared: new Set() });
    if (doc.uri.scheme !== 'file') return local();
    const available = getEntries();
    const resolved = [], unresolved = [];
    for (const entry of available) {
      try { resolved.push(filesFor(entry)); }
      catch (error) {
        let model;
        try { model = filesFor(entry, true).model; } catch { /* The model path itself is dynamic. */ }
        unresolved.push({ entry, error, model });
      }
    }
    const selected = getSelectedEntry();
    const broken = unresolved.find(item => selected && identity(item.entry) === identity(selected));
    if (broken) throw new Error(`構成「${broken.entry.config.name}」のモデル・データを確定できません。固定パスを指定してください。`);
    const matching = resolved.filter(item => [item.model, ...item.data].includes(doc.uri.fsPath));
    let project = matching.find(item => selected && identity(item.entry) === identity(selected))
      || matching.find(item => item.model === choices.get(doc.uri.toString()));
    const models = [...new Set(matching.map(item => item.model))];
    if (!project && models.length === 1) project = matching[0];
    if (!project && models.length > 1) {
      const pick = await vscode.window.showQuickPick(models.map(model => ({ label: matching.find(item => item.model === model).entry.config.name,
        description: model, model })), { title: 'リファクタリングの対象にする実行構成' });
      if (!pick || token.isCancellationRequested) return;
      project = matching.find(item => item.model === pick.model);
      choices.set(doc.uri.toString(), project.model);
    }
    if (!project) {
      if (unresolved.some(item => item.model === doc.uri.fsPath)) throw new Error('関連するデータファイルを確定できません。実行構成のパスを確認してください。');
      return local();
    }
    if (unresolved.some(item => item.model === project.model)) throw new Error('同じモデルを使う別の実行構成のデータを確定できません。パスを確認してください。');
    const data = [...new Set(resolved.filter(item => item.model === project.model).flatMap(item => item.data))];
    const shared = new Set(data.filter(file => resolved.some(item => item.model !== project.model && item.data.includes(file)))
      .map(file => vscode.Uri.file(file).toString()));
    const files = [];
    for (const file of [project.model, ...data]) {
      if (token.isCancellationRequested) return;
      let input;
      try { input = await vscode.workspace.openTextDocument(vscode.Uri.file(file)); }
      catch { throw new Error(`リファクタリングの対象を読み込めません: ${file}`); }
      files.push({ id: input.uri.toString(), doc: input, version: input.version, text: input.getText(), role: file === project.model ? 'model' : 'data' });
    }
    if (files.some(file => file.doc.version !== file.version)) throw new Error('対象ファイルが変更されました。もう一度操作してください。');
    return { files, shared };
  }
  async function target(doc, position, token, strict) {
    const project = await projectFor(doc, token);
    if (!project || token.isCancellationRequested) return;
    const index = indexProject(project.files);
    const symbol = symbolAt(index, doc.uri.toString(), doc.offsetAt(position));
    if (!symbol) { if (strict) throw new Error('この位置は変更可能なモデル宣言やデータ見出しではありません。'); return; }
    if (strict && index.references.some(ref => ref.name === symbol.name && project.shared.has(ref.file)))
      throw new Error('変更対象のデータは別のモデルでも共有されています。モデルごとにデータを分けてから名前を変更してください。');
    return { ...project, index, symbol };
  }
  const selector = { language: 'mathprog' };
  context.subscriptions.push(vscode.languages.registerRenameProvider(selector, {
    async prepareRename(doc, position, token) {
      const result = await target(doc, position, token, true); if (!result) return;
      renameEdits(result.index, result.symbol, result.symbol.name);
      const ref = result.index.references.find(ref => ref.file === doc.uri.toString() && ref.name === result.symbol.name && ref.start <= doc.offsetAt(position) && doc.offsetAt(position) <= ref.end);
      return { range: new vscode.Range(doc.positionAt(ref.start), doc.positionAt(ref.end)), placeholder: result.symbol.name };
    },
    async provideRenameEdits(doc, position, newName, token) {
      const result = await target(doc, position, token, true); if (!result) return;
      const edit = new vscode.WorkspaceEdit();
      for (const item of renameEdits(result.index, result.symbol, newName)) {
        const file = result.files.find(file => file.id === item.file);
        edit.replace(file.doc.uri, new vscode.Range(file.doc.positionAt(item.start), file.doc.positionAt(item.end)), item.text);
      }
      if (result.files.some(file => file.version !== undefined && file.doc.version !== file.version)) throw new Error('対象が変更されました。もう一度名前の変更を実行してください。');
      return edit;
    }
  }), vscode.languages.registerReferenceProvider(selector, {
    async provideReferences(doc, position, options, token) {
      const result = await target(doc, position, token, false); if (!result) return [];
      return result.index.references.filter(ref => ref.name === result.symbol.name && (options.includeDeclaration || !ref.declaration)).map(ref => {
        const file = result.files.find(file => file.id === ref.file);
        return new vscode.Location(file.doc.uri, new vscode.Range(file.doc.positionAt(ref.start), file.doc.positionAt(ref.end)));
      });
    }
  }), vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('launch')) choices.clear(); }));
}
module.exports = { registerRefactoring };

'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const src = path.resolve(__dirname, '../src');
const disposable = () => ({ dispose() {} });
function uri(file) { return { scheme: 'file', fsPath: file, toString: () => `file://${file}` }; }
function fixture(options = {}) {
  const folder = { uri: uri('/workspace'), name: 'workspace', index: 0 };
  const calls = { dialogs: [], errors: [], notices: [], opened: [], launches: 0, writes: [] };
  const commands = new Map();
  const settings = { version: '0.2.0', configurations: [{ type: 'node', name: 'Existing', request: 'launch' }] };
  const global = options.global || new Map();
  const state = new Map([['analysisEnabled', false]]);
  const memento = map => ({ get: key => map.get(key), update: async (key, value) => { if (value === undefined) map.delete(key); else map.set(key, value); } });
  const dialogs = options.dialogs ?? [[uri('/workspace/model.mod')]];
  const picks = options.picks ?? ['モデル内のデータを使う'];
  const vscode = {
    Uri: { file: uri, joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts)) },
    ConfigurationTarget: { WorkspaceFolder: 3 }, StatusBarAlignment: { Right: 2 },
    workspace: {
      isTrusted: true, workspaceFolders: options.noWorkspace ? undefined : [folder], textDocuments: [],
      getWorkspaceFolder: () => folder,
      getConfiguration: () => ({ get: (key, fallback) => settings[key] ?? fallback,
        update: async (key, value) => { settings[key] = value; calls.writes.push(key); } }),
      openTextDocument: async target => ({ uri: target }), onDidChangeTextDocument: disposable,
      onDidSaveTextDocument: disposable, onDidOpenTextDocument: disposable, onDidChangeConfiguration: disposable,
      onDidChangeWorkspaceFolders: disposable, onDidGrantWorkspaceTrust: disposable
    },
    window: {
      onDidChangeActiveTextEditor: disposable, createStatusBarItem: () => ({ show() {}, hide() {}, dispose() {} }),
      createOutputChannel: () => ({ dispose() {}, append() {}, appendLine() {}, show() {}, clear() {} }),
      showOpenDialog: async opts => { calls.dialogs.push(opts); return dialogs.shift(); },
      showQuickPick: async items => typeof items[0] === 'object' ? items[0] : picks.shift(), showInputBox: async () => options.cancelName ? undefined : 'New run',
      showInformationMessage: async message => { calls.notices.push(message); },
      showWarningMessage: async message => { calls.notices.push(message); },
      showErrorMessage: async message => { calls.errors.push(message); },
      showTextDocument: async doc => { calls.opened.push(doc.uri.fsPath); }
    },
    languages: {
      createDiagnosticCollection: () => ({ dispose() {}, delete() {}, clear() {} }),
      registerCompletionItemProvider: disposable, registerHoverProvider: disposable,
      registerDefinitionProvider: disposable, registerDocumentSymbolProvider: disposable
    },
    debug: { registerDebugConfigurationProvider: disposable, registerDebugAdapterDescriptorFactory: disposable,
      onDidStartDebugSession: disposable, onDidTerminateDebugSession: disposable, startDebugging: async () => { calls.launches++; return false; } },
    commands: {
      registerCommand: (id, fn) => { commands.set(id, fn); return disposable(); },
      executeCommand: async (id, target) => { calls.openFolder = { id, path: target.fsPath }; }
    }
  };
  const mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(src, 'extension.js'), 'utf8'), {
    module: mod, require: id => id === 'vscode' ? vscode : id === './automaticAnalysis'
      ? { registerAutomaticAnalysis: () => ({ schedule() {}, async pause() {}, resume() {} }) }
      : require(id.startsWith('./') ? path.join(src, id) : id)
  }, { filename: 'extension.js' });
  mod.exports.activate({ subscriptions: [], workspaceState: memento(state), globalState: memento(global) });
  return { calls, commands, settings, global, state, folder };
}

test('Run and Check open creation directly without notifications or starting a process', async () => {
  for (const command of ['mathprog.run', 'mathprog.check']) {
    for (const argument of [undefined, uri('/workspace/model.mod'), { groupId: 1 }]) {
      const f = fixture();
      assert.equal(await f.commands.get(command)(argument), false);
      assert.equal(f.calls.dialogs[0].title, '実行するモデルを選択');
      assert.equal(f.settings.configurations.length, 2);
      assert.equal(f.settings.configurations[0].name, 'Existing');
      assert.equal(f.settings.configurations[1].name, 'New run');
      assert.equal(f.calls.opened[0], '/workspace/.vscode/launch.json');
      assert.equal(f.calls.errors.length, 0); assert.equal(f.calls.notices.length, 0);
      assert.equal(f.calls.launches, 0);
    }
  }
});

test('cancelling any configuration wizard step is quiet and does not save or run', async () => {
  const scenarios = [{ dialogs: [undefined] }, { picks: [undefined] },
    { picks: ['外部のデータファイルを使う'], dialogs: [[uri('/workspace/model.mod')], undefined] },
    { cancelName: true }];
  for (const options of scenarios) {
    const f = fixture(options);
    assert.equal(await f.commands.get('mathprog.run')(), false);
    assert.equal(f.calls.errors.length, 0); assert.equal(f.calls.notices.length, 0);
    assert.equal(f.calls.writes.length, 0); assert.equal(f.calls.launches, 0);
  }
});

test('no-workspace flow selects a folder and resumes the wizard in that folder', async () => {
  const f = fixture({ noWorkspace: true, dialogs: [[uri('/workspace')]] });
  assert.equal(await f.commands.get('mathprog.check')(), false);
  assert.equal(f.calls.dialogs[0].canSelectFolders, true);
  assert.equal(f.calls.openFolder.id, 'vscode.openFolder');
  assert.equal(f.global.get('pendingCreateConfiguration').folder, 'file:///workspace');
  assert.equal(f.calls.errors.length, 0);
  const resumed = fixture({ global: f.global });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(resumed.settings.configurations[1].name, 'New run');
  assert.equal(resumed.global.has('pendingCreateConfiguration'), false);
  assert.equal(resumed.calls.errors.length, 0); assert.equal(resumed.calls.launches, 0);
});

test('cancelling folder selection and expired or unrelated resume requests do not prompt errors', async () => {
  const cancelled = fixture({ noWorkspace: true, dialogs: [undefined] });
  assert.equal(await cancelled.commands.get('mathprog.run')(), false);
  assert.equal(cancelled.global.size, 0); assert.equal(cancelled.calls.errors.length, 0);
  const expired = fixture({ global: new Map([['pendingCreateConfiguration', { folder: 'file:///workspace', requestedAt: Date.now() - 600000 }]]) });
  const unrelated = fixture({ global: new Map([['pendingCreateConfiguration', { folder: 'file:///other', requestedAt: Date.now() }]]) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(expired.calls.dialogs.length, 0); assert.equal(expired.global.size, 0);
  assert.equal(unrelated.calls.dialogs.length, 0);
});


test('editor URI arguments use an existing configuration and still open the configuration picker', async () => {
  const f = fixture();
  const draft = { type: 'mathprog', request: 'launch', name: 'Saved', model: '/workspace/model.mod', data: [] };
  await f.commands.get('mathprog.createConfiguration')(draft);
  assert.equal(await f.commands.get('mathprog.run')(uri('/workspace/model.mod')), false);
  assert.equal(await f.commands.get('mathprog.check')(uri('/workspace/data.dat')), false);
  assert.equal(f.calls.launches, 2); assert.equal(f.calls.errors.length, 0);
  assert.equal(await f.commands.get('mathprog.selectConfiguration')(uri('/workspace/model.mod')), 'Saved');
});

'use strict';
const path = require('node:path');

const initialConfiguration = {
  type: 'mathprog', request: 'launch', name: 'MathProg: Run',
  model: '${workspaceFolder}/model.mod', data: [], cwd: '${workspaceFolder}'
};

// VS Code substitutes ${workspaceFolder}, ${env:...}, etc. before this validation.
function resolveRunConfiguration(raw, root, defaults = {}) {
  if (!root) throw new Error('実行構成を保存したワークスペースフォルダーが必要です。');
  if (raw.type !== 'mathprog' || raw.request !== 'launch') throw new Error('type は mathprog、request は launch を指定してください。');
  const text = (value, key) => {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} に空でない文字列を指定してください。`);
    if (/\$\{[^}]+\}/.test(value)) throw new Error(`${key} に解決できない変数があります: ${value}`);
    return value;
  };
  const name = text(raw.name, 'name');
  const model = path.resolve(root, text(raw.model, 'model'));
  const data = raw.data ?? [];
  if (!Array.isArray(data) || data.length > 10) throw new Error('data はデータファイルの配列（最大10件）にしてください。');
  const resolvedData = data.map((file, index) => path.resolve(root, text(file, `data[${index}]`)));
  if (new Set(resolvedData).size !== resolvedData.length) throw new Error('data に同じファイルが重複しています。');
  const cwd = path.resolve(root, text(raw.cwd ?? root, 'cwd'));
  const action = raw.action ?? 'run';
  if (!['run', 'check'].includes(action)) throw new Error('action は run または check を指定してください。');
  const timeLimit = raw.timeLimit ?? defaults.timeLimit ?? 60;
  if (!Number.isInteger(timeLimit) || timeLimit < 1 || timeLimit > 86400) throw new Error('timeLimit は1〜86400の整数にしてください。');
  let glpsolPath = text(raw.glpsolPath ?? defaults.glpsolPath ?? 'glpsol', 'glpsolPath');
  if (/[\\/]/.test(glpsolPath)) glpsolPath = path.resolve(root, glpsolPath);
  return { name, model, data: resolvedData, cwd, action, timeLimit, glpsolPath };
}

function workspacePath(root, file) {
  const relative = path.relative(root, file);
  return path.isAbsolute(relative) ? file : '${workspaceFolder}/' + relative.split(path.sep).join('/');
}
module.exports = { initialConfiguration, resolveRunConfiguration, workspacePath };

// Background analysis must never prompt for input or execute command variables/pre-launch tasks.
function resolveAnalysisConfiguration(raw, root, defaults = {}, variables = {}) {
  const substitute = value => {
    if (typeof value !== 'string') return value;
    return value.replace(/\$\{([^}]+)\}/g, (_, key) => {
      if (key === 'workspaceFolder') return root;
      if (key.startsWith('workspaceFolder:') && variables.folders?.[key.slice(16)]) return variables.folders[key.slice(16)];
      if (key.startsWith('env:') && variables.env?.[key.slice(4)] !== undefined) return variables.env[key.slice(4)];
      if (key === 'workspaceFolderBasename') return path.basename(root);
      if (key === 'pathSeparator' || key === '/') return path.sep;
      const file = variables.file;
      if (file) {
        if (key === 'file') return file;
        if (key === 'fileDirname') return path.dirname(file);
        if (key === 'fileBasename') return path.basename(file);
        if (key === 'fileBasenameNoExtension') return path.basename(file, path.extname(file));
        if (key === 'fileExtname') return path.extname(file);
      }
      throw new Error(`自動解析では変数を解決できません: \${${key}}。固定パスを指定するか手動チェックを使用してください。`);
    });
  };
  const config = { ...raw, action: 'check' };
  for (const key of ['name', 'model', 'cwd', 'glpsolPath']) if (config[key] !== undefined) config[key] = substitute(config[key]);
  if (Array.isArray(config.data)) config.data = config.data.map(substitute);
  return resolveRunConfiguration(config, root, { ...defaults, glpsolPath: substitute(defaults.glpsolPath) });
}
module.exports.resolveAnalysisConfiguration = resolveAnalysisConfiguration;

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

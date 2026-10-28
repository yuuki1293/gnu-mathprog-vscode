'use strict';

const help = {
  set: '集合を宣言します。例: set PRODUCTS;',
  param: 'パラメーターを宣言します。例: param cost{PRODUCTS} >= 0;',
  var: '決定変数を宣言します。例: var x{PRODUCTS} >= 0;',
  minimize: '最小化する目的関数を定義します。例: minimize Cost: sum {i in I} c[i]*x[i];',
  maximize: '最大化する目的関数を定義します。',
  'subject to': '制約式を定義します。例: subject to Capacity: sum {i in I} x[i] <= 10;',
  solve: '生成した最適化問題を解きます。solve の後で解を表示できます。',
  display: '集合、パラメーター、変数や式の値を表示します。',
  printf: '書式付きの出力を行います。例: printf "x = %g\\n", x;',
  check: '条件式が真であることを検査します。',
  data: 'モデルに続くデータセクションを開始します。',
  end: 'モデルまたはデータセクションを終了します。',
  integer: '変数を整数に制限します。', binary: '変数を 0 または 1 に制限します。',
  symbolic: '文字列を値として持つパラメーターを宣言します。',
  default: '省略されたデータの既定値を指定します。',
  in: '集合の要素を列挙、または集合への所属を検査します。',
  within: '集合を別の集合の部分集合に制限します。',
  sum: '添字集合にわたる総和。例: sum {i in I} x[i]',
  prod: '添字集合にわたる総積。', forall: 'すべての要素について条件が真か検査します。',
  exists: '条件を満たす要素が存在するか検査します。', setof: '式から集合を構築します。',
  card: '集合の要素数を返します。', abs: '絶対値を返します。',
  ceil: '切り上げた整数を返します。', floor: '切り捨てた整数を返します。',
  sqrt: '平方根を返します。', round: '指定桁数で四捨五入します。',
  min: '最小値を返します。', max: '最大値を返します。',
  log: '自然対数を返します。', log10: '常用対数を返します。', exp: '指数関数を返します。',
  sin: '正弦を返します。', cos: '余弦を返します。', atan: '逆正接を返します。',
  length: '文字列の長さを返します。', substr: '部分文字列を返します。',
  trunc: '指定桁数で切り捨てます。',
  Uniform: '指定範囲の一様乱数を生成します。', Uniform01: '0〜1 の一様乱数を生成します。',
  Normal: '正規乱数を生成します。', Normal01: '標準正規乱数を生成します。',
  Irand224: '疑似乱数の非負整数を返します。',
  gmtime: '現在の UTC 時刻を秒単位で返します。',
  str2time: '文字列を時刻に変換します。', time2str: '時刻を書式付き文字列に変換します。'
};
const keywords = [...new Set([...Object.keys(help), ...'for table if then else and or not div mod less union inter diff symdiff cross by dimen IN OUT'.split(' ')])];

// Use one lexical pattern for masking and comment discovery, so markers inside strings are ignored.
const nonCodePattern = /#[^\r\n]*|\/\*[\s\S]*?(?:\*\/|$)|"(?:""|[^"])*(?:"|$)|'(?:''|[^'])*(?:'|$)/g;

// Mask comments and strings without changing offsets, including CRLF and multiline input.
function mask(text) {
  return text.replace(nonCodePattern,
    value => value.replace(/[^\r\n]/g, ' '));
}

function commentTokens(text, clean) {
  const result = [];
  for (const match of text.matchAll(nonCodePattern)) {
    const raw = match[0];
    if (!raw.startsWith('#') && !raw.startsWith('/*')) continue;
    const lineStart = text.lastIndexOf('\n', match.index - 1) + 1;
    let content = raw.startsWith('#') ? raw.slice(1).replace(/^ ?/, '') : raw.slice(2, -2);
    if (raw.startsWith('/*')) {
      const lines = content.split(/\r?\n/).map(line => line.replace(/^[ \t]*\* ?/, ''));
      while (lines.length && !lines[0].trim()) lines.shift();
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
      const indent = Math.min(...lines.filter(line => line.trim()).map(line => line.match(/^[ \t]*/)[0].length));
      content = lines.map(line => line.slice(Math.min(indent, line.match(/^[ \t]*/)[0].length))).join('\n');
    }
    result.push({ start: match.index, end: match.index + raw.length, content: content.trim(),
      leading: !clean.slice(lineStart, match.index).trim() });
  }
  return result;
}

function precedingComment(text, start, comments) {
  const parts = [];
  let cursor = start;
  for (let i = comments.length - 1; i >= 0; i--) {
    const comment = comments[i];
    if (comment.end > cursor) continue;
    const gap = text.slice(comment.end, cursor);
    // A blank line, intervening statement, or another statement's trailing comment is a boundary.
    if (!comment.leading || gap.trim() || (gap.match(/\n/g) || []).length > 1) break;
    parts.unshift(comment.content);
    cursor = comment.start;
  }
  return parts.join('\n').trim();
}

function declarations(text) {
  const clean = mask(text);
  const comments = commentTokens(text, clean);
  const result = [];
  const pattern = /(?:^|;)\s*(set|param|var|minimize|maximize|subject\s+to|s\.t\.)\s+([A-Za-z_][A-Za-z0-9_]*)/g;
  for (const match of clean.matchAll(pattern)) {
    const name = match[2];
    const offset = match.index + match[0].lastIndexOf(name);
    const start = match.index + match[0].indexOf(match[1]);
    const end = clean.indexOf(';', offset);
    result.push({ name, kind: match[1].replace(/\s+/g, ' '), offset, start,
      end: end < 0 ? text.length : end + 1,
      comment: precedingComment(text, start, comments),
      detail: text.slice(start, end < 0 ? text.length : end + 1).replace(/\s+/g, ' ').slice(0, 300) });
    // Data section assignments must not shadow model declarations.
    if (/\bdata\s*;/.test(clean.slice(0, start))) break;
  }
  const dataStart = /(?:^|;)\s*data\s*;/.exec(clean);
  return dataStart ? result.filter(item => item.start < dataStart.index) : result;
}

function parseDiagnostics(output, cwd) {
  const path = require('node:path');
  const result = [];
  for (const line of output.split(/\r?\n/)) {
    const match = /^(.*?):(\d+):\s*(.+)$/.exec(line);
    if (!match || !match[1] || Number(match[2]) < 1) continue;
    result.push({ file: path.resolve(cwd, match[1]), line: Number(match[2]) - 1, message: match[3] });
  }
  return result;
}

function solverArgs(model, data, check, limit) {
  const args = ['--model', model];
  for (const file of typeof data === 'string' ? [data] : data || []) args.push('--data', file);
  if (check) args.push('--check');
  args.push('--tmlim', String(limit));
  return args;
}
module.exports = { help, keywords, mask, declarations, parseDiagnostics, solverArgs };

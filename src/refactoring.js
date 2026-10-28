'use strict';
const { keywords } = require('./language');
const protectedNames = new Set([...keywords.flatMap(word => word.split(/\s+/)), 'subj', 'to', 's.t.']);
const functional = new Set(['solve', 'check', 'display', 'printf', 'for', 'table', 'data', 'end']);

function tokenize(text) {
  const tokens = [];
  const pattern = /\s+|#[^\r\n]*|\/\*[\s\S]*?\*\/|"(?:""|[^"])*"|'(?:''|[^'])*'|s\.t\.|(?:\d+\.(?!\.)\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z0-9_]*|:=|<-|<=|>=|<>|!=|==|\*\*|\.\.|[^\s]/gy;
  let offset = 0;
  while (offset < text.length) {
    pattern.lastIndex = offset;
    const match = pattern.exec(text);
    if (!match) throw new Error('字句を解析できません。構文を確認してください。');
    const value = match[0];
    const start = offset;
    offset += value.length;
    if (/^\s|^#|^\/\*/.test(value)) continue;
    if (value === '"' || value === "'" || (value === '/' && text[start + 1] === '*')) throw new Error('閉じられていない文字列またはコメントがあります。');
    tokens.push({ value, start, end: offset,
      kind: /^["']/.test(value) ? 'string' : /^[A-Za-z_]\w*$/.test(value) ? 'id' : 'other' });
  }
  const stack = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (['(', '[', '{'].includes(token.value)) stack.push(i);
    if ([')', ']', '}'].includes(token.value)) {
      const opening = stack.pop();
      if (opening === undefined || '([{'.indexOf(tokens[opening].value) !== ')]}'.indexOf(token.value)) throw new Error('対応していない括弧があります。');
      tokens[opening].mate = i; token.mate = opening;
    }
  }
  if (stack.length) throw new Error('閉じられていない括弧があります。');
  return tokens;
}

function statements(tokens) {
  const result = [];
  for (let start = 0; start < tokens.length;) {
    if (tokens[start].value === ';') { start++; continue; }
    let end;
    if (tokens[start].value === 'for') {
      let body = start + 1;
      if (tokens[body]?.value === '{') body = tokens[body].mate + 1;
      if (tokens[body]?.value === '{') end = tokens[body].mate + 1;
    }
    if (end === undefined) {
      let i = start;
      while (i < tokens.length && tokens[i].value !== ';') i = tokens[i].mate > i ? tokens[i].mate + 1 : i + 1;
      if (i === tokens.length) throw new Error('文末のセミコロンを確認してください。');
      end = i + 1;
    }
    result.push({ start, end, tag: tokens[start].value });
    start = end;
    if (result.at(-1).tag === 'end') break;
  }
  return result;
}

function dataHeaders(tokens, statement) {
  const { start, end, tag } = statement;
  if (tag === 'data' || tag === 'end') return [];
  if (tag !== 'set' && tag !== 'param') throw new Error('データファイルの set / param 文を確認してください。');
  const header = (index, kind) => {
    const token = tokens[index];
    if (!token || token.kind !== 'id') throw new Error('データの見出しを解析できません。');
    return { ...token, kind };
  };
  if (tag === 'set') return [header(start + 1, 'set')];
  let index = start + 1;
  if (tokens[index]?.value === 'default') {
    index++;
    if (['+', '-'].includes(tokens[index]?.value)) index++;
    index++;
  }
  if (tokens[index]?.value !== ':') return [header(start + 1, 'param')];
  const beforeAssign = [];
  for (let i = index + 1; i < end && tokens[i].value !== ':='; i++) beforeAssign.push(i);
  if (!beforeAssign.length || tokens[beforeAssign.at(-1) + 1]?.value !== ':=') throw new Error('表形式データの見出しを解析できません。');
  const colon = beforeAssign.findIndex(i => tokens[i].value === ':');
  const result = [];
  if (colon >= 0) {
    if (colon !== 1) throw new Error('表形式データの集合名を解析できません。');
    result.push(header(beforeAssign[0], 'set'));
  }
  for (const i of beforeAssign.slice(colon >= 0 ? colon + 1 : 0)) {
    if (tokens[i].value !== ',') result.push(header(i, 'param'));
  }
  return result;
}

function rootItems(tokens, start, end) {
  const parts = [];
  let first = start;
  for (let i = start; i < end; i++) {
    if (tokens[i].mate > i) { i = tokens[i].mate; continue; }
    if (tokens[i].value === ',') { if (i > first) parts.push([first, i]); first = i + 1; }
  }
  if (end > first) parts.push([first, end]);
  return parts;
}

function tableMetadata(tokens, statement, excluded, aliases) {
  excluded.add(statement.start + 1); // table label, not a model reference
  let direction, colon;
  for (let i = statement.start + 2; i < statement.end; i++) {
    if (tokens[i].mate > i) { i = tokens[i].mate; continue; }
    if (['IN', 'OUT'].includes(tokens[i].value)) direction = i;
    if (direction !== undefined && tokens[i].value === ':') { colon = i; break; }
  }
  if (direction === undefined || colon === undefined) throw new Error('table 文を解析できません。');
  let first = colon + 1;
  if (tokens[direction].value === 'IN') {
    let bracket = first;
    while (bracket < statement.end && tokens[bracket].value !== '[') bracket++;
    if (bracket === statement.end) throw new Error('table IN の列名を解析できません。');
    for (let i = bracket; i <= tokens[bracket].mate; i++) excluded.add(i);
    first = tokens[bracket].mate + 1;
    if (tokens[first]?.value === ',') first++;
  }
  for (const [begin, finish] of rootItems(tokens, first, statement.end - 1)) {
    let tilde;
    for (let i = begin; i < finish; i++) {
      if (tokens[i].mate > i) { i = tokens[i].mate; continue; }
      if (tokens[i].value === '~') { tilde = i; break; }
    }
    if (tilde !== undefined) {
      for (let i = tilde + 1; i < finish; i++) excluded.add(i);
    } else if (tokens[begin]?.kind === 'id') {
      // Keep the external CSV/DB field name when its implicit name would otherwise change.
      aliases.push({ first: begin, end: tokens[finish - 1].end, name: tokens[begin].value });
    }
  }
}

function analyzeModel(file) {
  const tokens = tokenize(file.text);
  const symbols = new Map(), references = [], identifiers = [], aliases = [];
  const excluded = new Set();
  const modelStatements = [], inline = [];
  let data = false;
  for (const statement of statements(tokens)) {
    if (statement.tag === 'data') { data = true; continue; }
    if (statement.tag === 'end') break;
    if (data) { inline.push(...dataHeaders(tokens, statement)); continue; }
    modelStatements.push(statement);
    let nameIndex, kind;
    if (['set', 'param', 'var', 'minimize', 'maximize'].includes(statement.tag)) { nameIndex = statement.start + 1; kind = statement.tag; }
    else if (['subject', 'subj'].includes(statement.tag) && tokens[statement.start + 1]?.value === 'to') { nameIndex = statement.start + 2; kind = 'constraint'; }
    else if (statement.tag === 's.t.') { nameIndex = statement.start + 1; kind = 'constraint'; }
    else if (!functional.has(statement.tag) && tokens[statement.start].kind === 'id') { nameIndex = statement.start; kind = 'constraint'; }
    if (nameIndex !== undefined) {
      const token = tokens[nameIndex];
      if (token?.kind !== 'id') throw new Error('宣言名を解析できません。');
      if (symbols.has(token.value)) throw new Error(`宣言名が重複しています: ${token.value}`);
      symbols.set(token.value, { name: token.value, kind, file: file.id, start: token.start, end: token.end });
    }
    if (statement.tag === 'table') tableMetadata(tokens, statement, excluded, aliases);
  }
  for (const statement of modelStatements) {
    for (let i = statement.start; i < statement.end; i++) {
      const token = tokens[i];
      if (token.kind !== 'id' || excluded.has(i) || tokens[i - 1]?.value === '.') continue;
      identifiers.push(token);
      const symbol = symbols.get(token.value);
      // A name may have been a local dummy index before the global declaration existed.
      if (symbol && token.start >= symbol.start) references.push({ ...token, file: file.id, name: token.value,
        declaration: token.start === symbol.start });
    }
  }
  for (const header of inline) {
    const symbol = symbols.get(header.value);
    if (symbol?.kind === header.kind) references.push({ ...header, file: file.id, name: header.value });
  }
  const implicit = aliases.filter(alias => references.some(ref => ref.start === tokens[alias.first].start));
  return { symbols, references, identifiers, aliases: implicit, tokens, inline };
}

function indexProject(files) {
  const model = files.find(file => file.role === 'model');
  let analyzed;
  if (model) analyzed = analyzeModel(model);
  else analyzed = { symbols: new Map(), references: [], identifiers: [], aliases: [] };
  const headers = [];
  for (const file of files.filter(file => file.role === 'data')) {
    const tokens = tokenize(file.text);
    for (const statement of statements(tokens)) {
      for (const header of dataHeaders(tokens, statement)) {
        headers.push({ ...header, file: file.id, name: header.value });
        if (!model && !analyzed.symbols.has(header.value)) analyzed.symbols.set(header.value,
          { name: header.value, kind: header.kind, file: file.id, start: header.start, end: header.end });
      }
    }
  }
  headers.push(...(analyzed.inline || []).map(header => ({ ...header, file: model.id, name: header.value })));
  for (const header of headers) {
    const symbol = analyzed.symbols.get(header.name);
    if (symbol?.kind === header.kind && !analyzed.references.some(ref => ref.file === header.file && ref.start === header.start))
      analyzed.references.push({ ...header, declaration: !model && symbol.file === header.file && symbol.start === header.start });
  }
  return { ...analyzed, headers, files };
}

function symbolAt(index, file, offset) {
  const ref = index.references.find(ref => ref.file === file && ref.start <= offset && offset <= ref.end);
  return ref && index.symbols.get(ref.name);
}

function renameEdits(index, symbol, newName) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(newName) || newName.length > 100) throw new Error('新しい名前は英字または _ で始まる100文字以内の識別子にしてください。');
  if (protectedNames.has(symbol.name)) throw new Error('キーワード・組み込み関数と同名の宣言は、一括変更に対応していません。');
  if (protectedNames.has(newName)) throw new Error('キーワード・組み込み関数の名前には変更できません。');
  if (newName === symbol.name) return [];
  if (index.symbols.has(newName) || index.identifiers.some(token => token.value === newName) || index.headers.some(header => header.name === newName))
    throw new Error(`変更先の名前は既に宣言、添字、参照、またはデータ見出しに使われています: ${newName}`);
  const result = index.references.filter(ref => ref.name === symbol.name)
    .map(ref => ({ file: ref.file, start: ref.start, end: ref.end, text: newName }));
  const model = index.files.find(file => file.role === 'model');
  if (model) for (const alias of index.aliases.filter(alias => alias.name === symbol.name))
    result.push({ file: model.id, start: alias.end, end: alias.end, text: ` ~ ${symbol.name}` });
  return result;
}
module.exports = { tokenize, indexProject, symbolAt, renameEdits };

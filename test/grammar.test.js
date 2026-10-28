'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const textmate = require('vscode-textmate');
const onig = require('vscode-oniguruma');

test('TextMate grammar tokenizes declarations, numbers, comments and multiline strings', async () => {
  await onig.loadWASM(fs.readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm')).buffer);
  const registry = new textmate.Registry({
    onigLib: Promise.resolve({ createOnigScanner: s => new onig.OnigScanner(s), createOnigString: s => new onig.OnigString(s) }),
    loadGrammar: async () => textmate.parseRawGrammar(fs.readFileSync(path.join(__dirname, '../syntaxes/mathprog.tmLanguage.json'), 'utf8'), 'mathprog.json')
  });
  const grammar = await registry.loadGrammar('source.mathprog');
  const line = 'var x >= 1.2e-3; # comment';
  const scopes = grammar.tokenizeLine(line).tokens.map(t => ({ text: line.slice(t.startIndex,t.endIndex), scopes:t.scopes.join(' ') }));
  assert.ok(scopes.some(t => t.text === 'var' && t.scopes.includes('storage.type')));
  assert.ok(scopes.some(t => t.text === '1.2e-3' && t.scopes.includes('constant.numeric')));
  assert.ok(scopes.some(t => t.text.includes('comment') && t.scopes.includes('comment.line')));
  let state = grammar.tokenizeLine('/* block').ruleStack;
  assert.ok(grammar.tokenizeLine('var fake;', state).tokens.every(t => t.scopes.some(s => s.includes('comment.block'))));
  state = grammar.tokenizeLine('printf "line').ruleStack;
  assert.ok(grammar.tokenizeLine('two";', state).tokens[0].scopes.some(s => s.includes('string.quoted')));
  const range = '1..5';
  const rangeTokens = grammar.tokenizeLine(range).tokens;
  assert.ok(rangeTokens.some(t => range.slice(t.startIndex, t.endIndex) === '..' && t.scopes.some(s => s.includes('keyword.operator'))));
  assert.equal(rangeTokens.filter(t => t.scopes.some(s => s.includes('constant.numeric'))).length, 2);
  registry.dispose();
});

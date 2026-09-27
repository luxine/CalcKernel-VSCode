import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

function firstRuleAtStart(grammar, line) {
  for (const entry of grammar.patterns) {
    const group = entry.include.slice(1);
    for (const pattern of grammar.repository[group].patterns) {
      const match = new RegExp(pattern.match).exec(line);
      if (match?.index === 0) return group;
    }
  }
  return undefined;
}

const readJson = (name) => JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'));

test('TextMate rules cover current CK keywords and types', () => {
  const grammar = readJson('syntaxes/calckernel.tmLanguage.json');
  const keywords = grammar.repository.keywords.patterns.map((pattern) => new RegExp(pattern.match));
  const types = grammar.repository.types.patterns.map((pattern) => new RegExp(pattern.match));
  for (const word of ['unsafe', 'contract', 'requires', 'effects', 'none', 'break', 'continue']) {
    assert.ok(keywords.some((pattern) => pattern.test(word)), `${word} needs a keyword rule`);
  }
  for (const word of ['i32', 'i64', 'u32', 'u64', 'f64', 'bool', 'void', 'ptr', 'slice']) {
    assert.ok(types.some((pattern) => pattern.test(word)), `${word} needs a type rule`);
  }
});

test('TextMate priority treats parenthesized control flow as keywords', () => {
  const grammar = readJson('syntaxes/calckernel.tmLanguage.json');
  assert.equal(firstRuleAtStart(grammar, 'if (ready) {'), 'keywords');
  assert.equal(firstRuleAtStart(grammar, 'while (ready) {'), 'keywords');
});

test('typed names are not forced into the struct field scope', () => {
  const grammar = readJson('syntaxes/calckernel.tmLanguage.json');
  assert.equal(firstRuleAtStart(grammar, 'weights: ptr<i64>'), 'typedNames');
});

test('subslice range does not become member access', () => {
  const grammar = readJson('syntaxes/calckernel.tmLanguage.json');
  const member = new RegExp(grammar.repository.memberAccess.patterns[0].match);
  assert.equal(member.exec('items[start..end]'), null);
  assert.ok(grammar.repository.operators.patterns.some((pattern) => new RegExp(pattern.match).test('..')));
});

test('language configuration supports CK comments and delimiters', () => {
  const config = readJson('language-configuration.json');
  assert.equal(config.comments.lineComment, '//');
  for (const pair of ['{}', '[]', '()']) {
    assert.ok(config.brackets.some(([open, close]) => open + close === pair));
  }
});

test('snippets cover current CK control flow, slices, and contracts', () => {
  const snippets = readJson('snippets/calckernel.json');
  const prefixes = new Set(Object.values(snippets).map((snippet) => snippet.prefix));
  for (const prefix of ['fn', 'void', 'struct', 'let', 'if', 'while', 'break', 'continue', 'slice', 'unsafe', 'contract']) {
    assert.ok(prefixes.has(prefix), `${prefix} snippet missing`);
  }
});

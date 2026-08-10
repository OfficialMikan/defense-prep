// Unit tests for lib/citations.js — run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    detectCitations, findReferencesSection,
    parseReferences, matchCitationToReference
} = require('../lib/citations');

test('detectCitations finds parenthetical and narrative citations', () => {
    const text = 'Smith (2020) noted this. Later, (Davis, 1989) confirmed it.';
    const cites = detectCitations(text);
    assert.equal(cites.length, 2);
    const smith = cites.find((c) => c.author === 'Smith');
    const davis = cites.find((c) => c.author === 'Davis');
    assert.ok(smith && smith.year === 2020 && smith.pattern_type === 'narrative');
    assert.ok(davis && davis.year === 1989 && davis.pattern_type === 'paren');
});

test('detectCitations deduplicates identical citations', () => {
    const text = '(Davis, 1989) and again (Davis, 1989)';
    assert.equal(detectCitations(text).length, 1);
});

test('detectCitations returns empty for no citations', () => {
    assert.deepEqual(detectCitations('No citations here.'), []);
    assert.deepEqual(detectCitations(null), []);
});

test('findReferencesSection extracts only the references block', () => {
    const text = '**INTRODUCTION**\nBody text.\n**REFERENCES**\nDavis, J. (1989). A book.\nSmith, A. (2020). Another book.\n**CONCLUSION**\nMore text.';
    const refs = findReferencesSection(text);
    assert.match(refs, /Davis, J\. \(1989\)/);
    assert.match(refs, /Smith, A\. \(2020\)/);
    assert.doesNotMatch(refs, /More text/);
    assert.equal(findReferencesSection('No references here.'), '');
});

test('parseReferences splits entries and extracts author/year/title', () => {
    const section = 'Davis, J. (1989). The Handbook of Research.\nSmith, A. (2020). Another Study.';
    const refs = parseReferences(section);
    assert.equal(refs.length, 2);
    assert.equal(refs[0].author, 'Davis');
    assert.equal(refs[0].year, 1989);
    assert.match(refs[0].title, /The Handbook of Research/);
    assert.equal(refs[1].author, 'Smith');
    assert.equal(refs[1].year, 2020);
});

test('parseReferences joins lowercase continuation lines into one entry', () => {
    const refs = parseReferences('Davis, J. (1989). The Handbook of Research.\n  published in New York.');
    assert.equal(refs.length, 1);
    assert.match(refs[0].reference_text, /New York/);
    assert.deepEqual(parseReferences(''), []);
});

test('matchCitationToReference matches by author then year', () => {
    const refs = parseReferences('Davis, J. (1989). Book A.\nSmith, A. (2020). Book B.');
    assert.equal(matchCitationToReference({ author: 'Davis', year: 1989 }, refs), 0);
    assert.equal(matchCitationToReference({ author: 'Smith', year: 2020 }, refs), 1);
    assert.equal(matchCitationToReference({ author: 'Unknown' }, refs), -1);
});
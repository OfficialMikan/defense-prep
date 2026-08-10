// Unit tests for lib/chunking.js — run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    normalizeText, splitIntoSections, chunkSection,
    splitIntoSentences, CHUNK_MIN_CHARS, CHUNK_TARGET_CHARS, CHUNK_MAX_CHARS
} = require('../lib/chunking');

test('normalizeText strips CR, collapses whitespace, trims', () => {
    // \r\n becomes \n\n (CR -> \n, then the existing \n) — documented behavior.
    assert.equal(normalizeText('  hi\r\nworld  '), 'hi\n\nworld');
    assert.equal(normalizeText('a   b\t\tc'), 'a b c');
    assert.equal(normalizeText('a\n\n\n\nb'), 'a\n\nb');
    assert.equal(normalizeText(null), '');
});

test('splitIntoSections splits on bold headings, Title fallback, ord order', () => {
    const sections = splitIntoSections('**INTRODUCTION**\nIntro text.\n**METHODOLOGY**\nMethod text.');
    assert.equal(sections.length, 2);
    assert.equal(sections[0].heading, 'INTRODUCTION');
    assert.equal(sections[1].heading, 'METHODOLOGY');
    assert.deepEqual(sections.map((s) => s.ord), [0, 1]);

    const withPreamble = splitIntoSections('Preamble.\n**STATEMENT**\nBody.');
    assert.equal(withPreamble[0].heading, 'Title');

    // Content before the first heading is treated as a "Title" section.
    const noHeadings = splitIntoSections('Just a plain paragraph.');
    assert.equal(noHeadings[0].heading, 'Title');
    assert.deepEqual(splitIntoSections(''), []);
});

test('splitIntoSentences ignores decimal numbers and abbreviations', () => {
    assert.equal(splitIntoSentences('The mean was 3.14 and p 0.05.').length, 1);
    assert.equal(splitIntoSentences('Dr. Smith et al. reported.').length, 1);
    assert.equal(splitIntoSentences('A. B. C?').length, 3);
});

test('chunkSection handles empty/short input and long text bounds', () => {
    assert.deepEqual(chunkSection(''), []);
    assert.deepEqual(chunkSection(null), []);
    const short = chunkSection('Short paragraph.');
    assert.equal(short.length, 1);
    assert.match(short[0].content, /Short paragraph/);

    const longText = 'The researchers administered a validated questionnaire to the respondents. '.repeat(200);
    const chunks = chunkSection(longText);
    assert.ok(chunks.length > 1, 'expected multiple chunks');
    for (const c of chunks) {
        assert.ok(c.content.length <= CHUNK_MAX_CHARS);
        assert.equal(typeof c.startIndex, 'number');
    }
});

test('chunkSection preserves both paragraphs', () => {
    const chunks = chunkSection('First paragraph content here.\n\nSecond paragraph content here.');
    const joined = chunks.map((c) => c.content).join(' ');
    assert.match(joined, /First paragraph/);
    assert.match(joined, /Second paragraph/);
});

test('chunking constants are consistent', () => {
    assert.ok(CHUNK_MIN_CHARS < CHUNK_TARGET_CHARS && CHUNK_TARGET_CHARS < CHUNK_MAX_CHARS);
});
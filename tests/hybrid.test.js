// Unit tests for lib/hybrid.js — run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    reciprocalRankFusion, metadataBoost, citationBoost, fuse
} = require('../lib/hybrid');

test('reciprocalRankFusion combines ranks from multiple lists', () => {
    const listA = [{ id: 'a', content: 'x' }, { id: 'b', content: 'y' }];
    const listB = [{ id: 'b', content: 'y' }, { id: 'c', content: 'z' }];
    const fused = reciprocalRankFusion([listA, listB]);
    assert.ok(fused.has('a'), 'a should be present');
    assert.ok(fused.has('b'), 'b should be present');
    assert.ok(fused.has('c'), 'c should be present');
    // b appears in both lists, so it should have a higher fused score than a/c.
    assert.ok(fused.get('b').score > fused.get('a').score);
    assert.ok(fused.get('b').score > fused.get('c').score);
});

test('metadataBoost rewards component and chapter matches', () => {
    const chunk = { component_key: 'introduction', doc_number: 2 };
    // No filters -> boost 0.
    assert.equal(metadataBoost(chunk), 0);
    // Component match only.
    assert.equal(metadataBoost(chunk, { componentKeys: ['introduction'] }), 0.5);
    // 'all' matches any component.
    assert.equal(metadataBoost(chunk, { componentKeys: ['all'] }), 0.5);
    // Chapter match only.
    assert.equal(metadataBoost(chunk, { chapterNumber: 2 }), 0.3);
    // Both: 0.5 + 0.3 = 0.8 (cap only applies above 1.0).
    assert.equal(metadataBoost(chunk, { componentKeys: ['introduction'], chapterNumber: 2 }), 0.8);
    // Wrong chapter -> no chapter boost.
    assert.equal(metadataBoost(chunk, { componentKeys: ['introduction'], chapterNumber: 3 }), 0.5);
});

test('citationBoost returns 1 when chunk mentions a queried author', () => {
    const chunk = { content: 'The study by Alvarez et al. found...', authors: 'Alvarez' };
    assert.equal(citationBoost(chunk, [{ author: 'Alvarez' }]), 1);
    assert.equal(citationBoost(chunk, [{ author: 'Smith' }]), 0);
    assert.equal(citationBoost(chunk, []), 0);
});

test('fuse sorts results by final score descending', () => {
    const listA = [{ id: 'q1', content: 'Questionnaire validated.', component_key: 'instruments', doc_number: 1 }];
    const listB = [{ id: 'q1', content: 'Questionnaire validated.', component_key: 'instruments', doc_number: 1 }, { id: 'q2', content: 'Other content.', component_key: 'methods', doc_number: 1 }];
    const results = fuse([listA, listB], { componentKeys: ['instruments'], chapterNumber: 1 });
    assert.equal(results.length, 2);
    assert.equal(results[0].id, 'q1');
    assert.ok(results[0].score >= results[1].score);
    assert.equal(typeof results[0].score, 'number');
});
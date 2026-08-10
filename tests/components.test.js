// Unit tests for lib/components.js — run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    COMPONENT_KEYWORDS, DEFAULT_COMPONENT_KEY,
    classifySection, keywordsForComponents
} = require('../lib/components');

test('classifySection maps headings to component keys', () => {
    assert.equal(classifySection('INTRODUCTION', ''), 'introduction');
    assert.equal(classifySection('Statement of the Problem', ''), 'statement');
    assert.equal(classifySection('Research Design', ''), 'research_design');
    assert.equal(classifySection('Respondents of the Study', ''), 'respondents');
    assert.equal(classifySection('Data Analysis', ''), 'data_analysis');
    assert.equal(classifySection('Instruments of the Study', ''), 'instruments');
    assert.equal(classifySection('Ethical Considerations', ''), 'ethical_considerations');
});

test('classifySection falls back to default for unknown content', () => {
    assert.equal(classifySection('Random Unknown Heading', ''), DEFAULT_COMPONENT_KEY);
    assert.equal(classifySection('', ''), DEFAULT_COMPONENT_KEY);
});

test('classifySection ignores text for references (handled separately)', () => {
    const result = classifySection('REFERENCES', 'Some references content.');
    assert.notEqual(result, 'references');
});

test('classifySection uses body text when heading is generic', () => {
    // Heading is generic, but body strongly indicates methodology.
    assert.equal(classifySection('Overview', 'We used a correlational quantitative research design with a validated questionnaire.'), 'research_design');
});

test('keywordsForComponents expands selected keys to keyword union', () => {
    const keywords = keywordsForComponents(['introduction', 'statement']);
    assert.ok(keywords.includes('introduction'));
    assert.ok(keywords.includes('aims to'));
    assert.ok(keywords.length >= 4);
});

test('keywordsForComponents handles empty/unknown keys', () => {
    assert.deepEqual(keywordsForComponents([]), []);
    assert.deepEqual(keywordsForComponents(['does_not_exist']), []);
});

test('COMPONENT_KEYWORDS covers the core research sections', () => {
    for (const key of ['introduction', 'research_design', 'respondents', 'statement', 'method', 'references', 'instruments', 'data_analysis']) {
        assert.ok(Array.isArray(COMPONENT_KEYWORDS[key]) && COMPONENT_KEYWORDS[key].length > 0, `missing keywords for ${key}`);
    }
});
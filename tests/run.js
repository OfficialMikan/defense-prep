/**
 * Test entry point - runs all test files in sequence.
 * `node tests/run.js` from the project root.
 */
const path = require('path');
const { run } = require('./_test-runner');

// Test files in execution order
const suites = [
    './storage.test.js',
    './api.test.js',
    './toast.test.js'
];

for (const file of suites) {
    console.log(`\n${file}`);
    require(path.join(__dirname, file));
}

run();

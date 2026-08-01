/**
 * Lightweight test framework - no dependencies
 * Usage:
 *   const { describe, it, assert, beforeEach, afterEach } = require('./_test-runner');
 *   describe('my module', () => {
 *     it('does something', () => {
 *       assert.equal(1 + 1, 2);
 *     });
 *   });
 */

let suites = [];
let currentSuite = null;
let currentHooks = { beforeEach: [], afterEach: [] };

function describe(name, fn) {
    const parent = currentSuite;
    const suite = { name, tests: [], beforeEach: [], afterEach: [], parent };
    suites.push(suite);
    currentSuite = suite;
    try {
        fn();
    } finally {
        currentSuite = parent;
    }
}

function it(name, fn) {
    if (!currentSuite) {
        throw new Error('it() must be called inside describe()');
    }
    currentSuite.tests.push({ name, fn });
}

function beforeEach(fn) {
    if (!currentSuite) throw new Error('beforeEach() must be called inside describe()');
    currentSuite.beforeEach.push(fn);
}

function afterEach(fn) {
    if (!currentSuite) throw new Error('afterEach() must be called inside describe()');
    currentSuite.afterEach.push(fn);
}

const assert = {
    equal(actual, expected, msg) {
        if (actual !== expected) {
            throw new Error(msg || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
        }
    },
    deepEqual(actual, expected, msg) {
        const a = JSON.stringify(actual);
        const e = JSON.stringify(expected);
        if (a !== e) {
            throw new Error(msg || `Deep equal failed.\n  Expected: ${e}\n  Actual:   ${a}`);
        }
    },
    ok(value, msg) {
        if (!value) throw new Error(msg || `Expected truthy value, got ${JSON.stringify(value)}`);
    },
    throws(fn, errorMatcher, msg) {
        let thrown = null;
        try { fn(); } catch (e) { thrown = e; }
        if (!thrown) throw new Error(msg || 'Expected function to throw');
        if (errorMatcher instanceof RegExp && !errorMatcher.test(thrown.message)) {
            throw new Error(msg || `Thrown error "${thrown.message}" did not match ${errorMatcher}`);
        }
        if (typeof errorMatcher === 'string' && !thrown.message.includes(errorMatcher)) {
            throw new Error(msg || `Thrown error "${thrown.message}" did not include "${errorMatcher}"`);
        }
    },
    doesNotThrow(fn, msg) {
        try { fn(); } catch (e) {
            throw new Error(msg || `Expected no throw, got: ${e.message}`);
        }
    }
};

async function run() {
    let passed = 0;
    let failed = 0;
    const failures = [];

    // Build inheritance chain of hooks for each suite
    const collectHooks = (suite) => {
        const befores = [];
        const afters = [];
        let s = suite;
        while (s) {
            befores.unshift(...s.beforeEach);
            afters.push(...s.afterEach);
            s = s.parent;
        }
        return { befores, afters };
    };

    for (const suite of suites) {
        const { befores, afters } = collectHooks(suite);
        for (const test of suite.tests) {
            const fullName = `${suite.name} > ${test.name}`;
            try {
                for (const hook of befores) await hook();
                await test.fn();
                for (const hook of afters) await hook();
                passed++;
                console.log(`  \u2713 ${fullName}`);
            } catch (err) {
                failed++;
                failures.push({ name: fullName, error: err });
                console.log(`  \u2717 ${fullName}\n    ${err.message}`);
            }
        }
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
}

module.exports = { describe, it, beforeEach, afterEach, assert, run };

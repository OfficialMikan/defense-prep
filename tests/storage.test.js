/**
 * Storage module tests
 * Loads js/storage.js into a sandboxed context with a mocked localStorage
 * and verifies safeStorage / historyStorage / chatStorage / themeStorage behavior.
 */

const path = require('path');
const fs = require('fs');
const vm = require('vm');
const { describe, it, beforeEach, assert } = require('./_test-runner');

function loadStorageScript() {
    const code = fs.readFileSync(path.join(__dirname, '..', 'js', 'storage.js'), 'utf8');
    const store = new Map();
    const localStorageMock = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
        clear: () => store.clear(),
        key: (i) => Array.from(store.keys())[i] || null,
        get length() { return store.size; }
    };
    const sandbox = { console, localStorage: localStorageMock };
    sandbox.global = sandbox;
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox);
    return { sandbox, store };
}

describe('safeStorage', () => {
    let sandbox, store;
    beforeEach(() => { ({ sandbox, store } = loadStorageScript()); });

    it('returns fallback for missing keys', () => {
        assert.equal(sandbox.safeStorage.get('missing', 'fb'), 'fb');
    });

    it('round-trips objects as JSON', () => {
        const obj = { a: 1, b: ['x', 'y'] };
        assert.equal(sandbox.safeStorage.set('k', obj), true);
        assert.deepEqual(sandbox.safeStorage.get('k'), obj);
    });

    it('removes keys', () => {
        sandbox.safeStorage.set('k', { v: 1 });
        sandbox.safeStorage.remove('k');
        assert.equal(sandbox.safeStorage.get('k', null), null);
    });

    it('falls back when stored value is malformed JSON', () => {
        store.set('broken', '{not json');
        assert.equal(sandbox.safeStorage.get('broken', 'fallback'), 'fallback');
    });
});

describe('STORAGE_KEYS', () => {
    it('is frozen and contains expected keys', () => {
        const { sandbox } = loadStorageScript();
        const keys = sandbox.STORAGE_KEYS;
        assert.equal(Object.isFrozen(keys), true);
        assert.equal(keys.history, 'mcesi_sim_history');
        assert.equal(keys.chat, 'chatHistory');
        assert.equal(keys.theme, 'theme');
    });
});

describe('historyStorage', () => {
    let sandbox;
    beforeEach(() => { ({ sandbox } = loadStorageScript()); });

    it('returns an empty array by default', () => {
        assert.deepEqual(sandbox.historyStorage.load(), []);
    });

    it('returns the saved cards on load', () => {
        const cards = [{ id: 1, label: 'A' }];
        sandbox.historyStorage.save(cards);
        assert.deepEqual(sandbox.historyStorage.load(), cards);
    });

    it('coerces non-array stored data to []', () => {
        const { store } = loadStorageScript();
        store.set('mcesi_sim_history', JSON.stringify('not an array'));
        // Reload with the corrupted value
        const { sandbox: s2 } = loadStorageScript();
        // New sandbox has its own store; manually inject corruption:
        // Instead: verify the coercion path via a sandboxed call:
        // We re-load with corrupted state by re-using the store map
        // For simplicity, accept that loadStorageScript resets the store;
        // the coercion test ensures the function does not throw on bad data.
        const code = fs.readFileSync(path.join(__dirname, '..', 'js', 'storage.js'), 'utf8');
        const corruptedStore = new Map([['mcesi_sim_history', JSON.stringify('not an array')]]);
        const ls = {
            getItem: (k) => (corruptedStore.has(k) ? corruptedStore.get(k) : null),
            setItem: (k, v) => corruptedStore.set(k, String(v)),
            removeItem: (k) => corruptedStore.delete(k),
            clear: () => corruptedStore.clear(),
            key: (i) => Array.from(corruptedStore.keys())[i] || null,
            get length() { return corruptedStore.size; }
        };
        const s3 = { console, localStorage: ls };
        s3.global = s3;
        s3.window = s3;
        vm.createContext(s3);
        vm.runInContext(code, s3);
        assert.deepEqual(s3.historyStorage.load(), []);
    });

    it('clear() removes the key', () => {
        sandbox.historyStorage.save([{ id: 1 }]);
        sandbox.historyStorage.clear();
        assert.deepEqual(sandbox.historyStorage.load(), []);
    });
});

describe('chatStorage', () => {
    let sandbox;
    beforeEach(() => { ({ sandbox } = loadStorageScript()); });

    it('saves and loads messages', () => {
        const msgs = [{ role: 'user', content: 'hi' }];
        sandbox.chatStorage.save(msgs);
        assert.deepEqual(sandbox.chatStorage.load(), msgs);
    });

    it('returns [] when nothing stored', () => {
        assert.deepEqual(sandbox.chatStorage.load(), []);
    });

    it('clear() removes messages', () => {
        sandbox.chatStorage.save([{ role: 'user', content: 'hi' }]);
        sandbox.chatStorage.clear();
        assert.deepEqual(sandbox.chatStorage.load(), []);
    });
});

describe('themeStorage', () => {
    let sandbox;
    beforeEach(() => { ({ sandbox } = loadStorageScript()); });

    it('returns null by default', () => {
        assert.equal(sandbox.themeStorage.load(), null);
    });

    it('persists the chosen theme', () => {
        sandbox.themeStorage.save('dark');
        assert.equal(sandbox.themeStorage.load(), 'dark');
    });
});

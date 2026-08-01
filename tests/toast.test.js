/**
 * Toast module tests
 * Loads js/toast.js into a sandboxed context with a stubbed DOM
 * and verifies toast creation, type classes, escaping, and capping.
 */

const path = require('path');
const fs = require('fs');
const vm = require('vm');
const { describe, it, beforeEach, assert } = require('./_test-runner');

function createClassList(initial = []) {
    const set = new Set(initial);
    return {
        add: (...c) => c.forEach(x => set.add(x)),
        remove: (...c) => c.forEach(x => set.delete(x)),
        contains: (c) => set.has(c),
        toggle: (c) => (set.has(c) ? (set.delete(c), false) : (set.add(c), true))
    };
}

function makeElement(tag) {
    const el = {
        tagName: tag.toUpperCase(),
        children: [],
        _innerHTML: '',
        classList: createClassList(),
        attributes: {},
        listeners: {},
        parentNode: null,
        get innerHTML() { return this._innerHTML; },
        set innerHTML(v) {
            this._innerHTML = v;
            this.children = [];
        },
        get textContent() {
            return this._textContent || '';
        },
        set textContent(v) {
            this._textContent = v;
            this._innerHTML = '';
            this.children = [];
        },
        appendChild(child) {
            child.parentNode = this;
            this.children.push(child);
            return child;
        },
        remove() {
            if (this.parentNode) {
                const idx = this.parentNode.children.indexOf(this);
                if (idx >= 0) this.parentNode.children.splice(idx, 1);
                this.parentNode = null;
            }
        },
        addEventListener(name, fn) {
            (this.listeners[name] = this.listeners[name] || []).push(fn);
        },
        setAttribute(k, v) { this.attributes[k] = String(v); },
        getAttribute(k) { return this.attributes[k] ?? null; },
        get firstElementChild() { return this.children[0] || null; }
    };
    return el;
}

function loadToastScript() {
    const code = fs.readFileSync(path.join(__dirname, '..', 'js', 'toast.js'), 'utf8');
    const body = makeElement('body');
    const documentMock = {
        body,
        createElement: (tag) => makeElement(tag)
    };
    const sandbox = { window: {}, console, document: documentMock };
    sandbox.global = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox);
    return { sandbox, body };
}

describe('TOAST_CONFIG', () => {
    it('is frozen and has sane defaults', () => {
        const { sandbox } = loadToastScript();
        assert.equal(Object.isFrozen(sandbox.TOAST_CONFIG), true);
        assert.ok(sandbox.TOAST_CONFIG.DEFAULT_DURATION_MS > 0);
        assert.ok(sandbox.TOAST_CONFIG.ERROR_DURATION_MS > sandbox.TOAST_CONFIG.DEFAULT_DURATION_MS);
        assert.equal(sandbox.TOAST_CONFIG.MAX_TOASTS, 5);
    });
});

describe('toast.init', () => {
    it('creates a container appended to body', () => {
        const { sandbox, body } = loadToastScript();
        assert.equal(body.children.length, 0);
        sandbox.toast.init();
        assert.equal(body.children.length, 1);
        assert.equal(body.children[0].attributes.role, 'region');
        assert.ok(body.children[0].classList.contains('toast-container'));
    });

    it('is idempotent (does not create a second container)', () => {
        const { sandbox, body } = loadToastScript();
        sandbox.toast.init();
        sandbox.toast.init();
        assert.equal(body.children.length, 1);
    });
});

describe('toast.show', () => {
    let sandbox, body;
    beforeEach(() => {
        ({ sandbox, body } = loadToastScript());
        sandbox.toast.init();
    });

    it('appends a toast element with the type class', () => {
        sandbox.toast.show('saved!', 'success');
        const container = body.children[0];
        assert.equal(container.children.length, 1);
        const t = container.children[0];
        assert.ok(t.classList.contains('toast'));
        assert.ok(t.classList.contains('toast--success'));
    });

    it('uses the default type of "info"', () => {
        sandbox.toast.show('hi');
        const t = body.children[0].children[0];
        assert.ok(t.classList.contains('toast--info'));
    });

    it('escapes HTML in the message', () => {
        sandbox.toast.show('<script>alert(1)</script>');
        const t = body.children[0].children[0];
        // find the .toast__message element
        const msgEl = t.children[1];
        assert.ok(msgEl._innerHTML.includes('<script>'));
        assert.ok(!msgEl._innerHTML.includes('<script>'));
    });

    it('sets role="alert" for errors and role="status" for others', () => {
        sandbox.toast.show('oops', 'error');
        const errEl = body.children[0].children[0];
        assert.equal(errEl.attributes.role, 'alert');
        assert.equal(errEl.attributes['aria-live'], 'assertive');

        sandbox.toast.show('ok', 'info');
        const infoEl = body.children[0].children[1];
        assert.equal(infoEl.attributes.role, 'status');
        assert.equal(infoEl.attributes['aria-live'], 'polite');
    });

    it('caps concurrent toasts at MAX_TOASTS', () => {
        const { sandbox: s, body: b } = loadToastScript();
        s.toast.init();
        for (let i = 0; i < 8; i++) s.toast.show(`#${i}`);
        assert.equal(b.children[0].children.length, 5);
    });

    it('convenience methods (success/error/warning/info) all work', () => {
        sandbox.toast.success('a');
        sandbox.toast.error('b');
        sandbox.toast.warning('c');
        sandbox.toast.info('d');
        const types = body.children[0].children.map(t => {
            for (const cls of t.classList._set ? Array.from(t.classList._set) : []) {
                if (cls.startsWith('toast--')) return cls;
            }
            return null;
        });
        // Reach into the set via attributes isn't possible; verify by string of classes
        // via the inner template instead:
        const htmls = body.children[0].children.map(t => t._innerHTML);
        assert.ok(htmls.some(h => h.includes('toast--success')));
        assert.ok(htmls.some(h => h.includes('toast--error')));
        assert.ok(htmls.some(h => h.includes('toast--warning')));
        assert.ok(htmls.some(h => h.includes('toast--info')));
    });
});

describe('toast.clear', () => {
    it('empties the container', () => {
        const { sandbox, body } = loadToastScript();
        sandbox.toast.init();
        sandbox.toast.show('a');
        sandbox.toast.show('b');
        assert.equal(body.children[0].children.length, 2);
        sandbox.toast.clear();
        assert.equal(body.children[0].children.length, 0);
    });
});

describe('showToast (window helper)', () => {
    it('is exposed on window and delegates to toast.show', () => {
        const { sandbox, body } = loadToastScript();
        sandbox.toast.init();
        sandbox.showToast('hello', 'warning');
        const t = body.children[0].children[0];
        assert.ok(t.classList.contains('toast--warning'));
    });
});

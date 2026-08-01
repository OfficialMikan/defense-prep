/**
 * Storage module - safe localStorage wrapper with namespacing
 * Handles history, chat, theme, and favorites persistence
 */

const safeStorage = {
    get(key, fallback = null) {
        try {
            const value = localStorage.getItem(key);
            return value === null ? fallback : JSON.parse(value);
        } catch (err) {
            console.error(`Storage read error [${key}]:`, err);
            return fallback;
        }
    },

    set(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (err) {
            console.error(`Storage write error [${key}]:`, err);
            return false;
        }
    },

    remove(key) {
        try {
            localStorage.removeItem(key);
            return true;
        } catch (err) {
            console.error(`Storage remove error [${key}]:`, err);
            return false;
        }
    },

    clear() {
        try {
            // Only clear our app's keys
            const keys = Object.values(STORAGE_KEYS);
            keys.forEach(k => localStorage.removeItem(k));
            return true;
        } catch (err) {
            console.error('Storage clear error:', err);
            return false;
        }
    }
};

const STORAGE_KEYS = Object.freeze({
    history: 'mcesi_sim_history',
    chat: 'chatHistory',
    darkMode: 'darkMode',
    theme: 'theme'
});

/**
 * History storage operations
 */
const historyStorage = {
    load() {
        const stored = safeStorage.get(STORAGE_KEYS.history, []);
        return Array.isArray(stored) ? stored : [];
    },

    save(cards) {
        return safeStorage.set(STORAGE_KEYS.history, cards);
    },

    clear() {
        return safeStorage.remove(STORAGE_KEYS.history);
    }
};

/**
 * Chat storage operations
 */
const chatStorage = {
    load() {
        const stored = safeStorage.get(STORAGE_KEYS.chat, []);
        return Array.isArray(stored) ? stored : [];
    },

    save(messages) {
        return safeStorage.set(STORAGE_KEYS.chat, messages);
    },

    clear() {
        return safeStorage.remove(STORAGE_KEYS.chat);
    }
};

/**
 * Theme storage operations
 */
const themeStorage = {
    load() {
        return safeStorage.get(STORAGE_KEYS.theme);
    },

    save(theme) {
        return safeStorage.set(STORAGE_KEYS.theme, theme);
    }
};

// Export to window for non-module script access
if (typeof window !== 'undefined') {
    window.safeStorage = safeStorage;
    window.STORAGE_KEYS = STORAGE_KEYS;
    window.historyStorage = historyStorage;
    window.chatStorage = chatStorage;
    window.themeStorage = themeStorage;
}

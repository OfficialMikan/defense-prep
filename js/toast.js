/**
 * Toast notification system - replaces alert() calls
 * Auto-dismisses with type-based colors and animations
 */

const TOAST_CONFIG = Object.freeze({
    DEFAULT_DURATION_MS: 3000,
    ERROR_DURATION_MS: 5000,
    MAX_TOASTS: 5,
    ICONS: {
        success: '✓',
        error: '✕',
        warning: '⚠',
        info: 'ℹ'
    }
});

const toast = {
    container: null,

    init() {
        if (this.container) return;
        this.container = document.createElement('div');
        this.container.className = 'toast-container';
        this.container.setAttribute('role', 'region');
        this.container.setAttribute('aria-label', 'Notifications');
        document.body.appendChild(this.container);
    },

    /**
     * Show a toast notification
     * @param {string} message - The message to display
     * @param {'success'|'error'|'warning'|'info'} type - Toast type
     * @param {number} duration - Display duration in ms
     */
    show(message, type = 'info', duration = TOAST_CONFIG.DEFAULT_DURATION_MS) {
        if (!this.container) this.init();

        // Cap concurrent toasts
        while (this.container.children.length >= TOAST_CONFIG.MAX_TOASTS) {
            this.container.firstElementChild?.remove();
        }

        const toastEl = document.createElement('div');
        toastEl.className = `toast toast--${type}`;
        toastEl.setAttribute('role', type === 'error' ? 'alert' : 'status');
        toastEl.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');

        const icon = TOAST_CONFIG.ICONS[type] || TOAST_CONFIG.ICONS.info;
        toastEl.innerHTML = `
            <span class="toast__icon" aria-hidden="true">${icon}</span>
            <span class="toast__message">${this.escapeHtml(message)}</span>
        `;

        this.container.appendChild(toastEl);

        const dismissTimeout = type === 'error'
            ? TOAST_CONFIG.ERROR_DURATION_MS
            : duration;

        const dismiss = () => {
            if (!toastEl.parentNode) return;
            toastEl.classList.add('toast--exit');
            toastEl.addEventListener('animationend', () => toastEl.remove(), { once: true });
            // Fallback in case animationend doesn't fire
            setTimeout(() => toastEl.remove(), 400);
        };

        setTimeout(dismiss, dismissTimeout);

        // Click to dismiss early
        toastEl.addEventListener('click', dismiss);

        return toastEl;
    },

    success(message, duration) {
        return this.show(message, 'success', duration);
    },

    error(message, duration) {
        return this.show(message, 'error', duration);
    },

    warning(message, duration) {
        return this.show(message, 'warning', duration);
    },

    info(message, duration) {
        return this.show(message, 'info', duration);
    },

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    clear() {
        if (this.container) this.container.innerHTML = '';
    }
};

if (typeof window !== 'undefined') {
    window.toast = toast;
    window.showToast = (message, type = 'info') => toast.show(message, type);
}

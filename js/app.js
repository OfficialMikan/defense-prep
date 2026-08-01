/**
 * Core app module - state, modules, and event wiring
 * Depends on: storage.js, toast.js, api.js, data.js
 */

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = Object.freeze({
    MAX_HISTORY_SIZE: 100,
    MAX_CHAT_HISTORY: 50,
    VIRTUAL_SCROLL_THRESHOLD: 50,
    VIRTUAL_ITEM_HEIGHT: 88, // approx height of .history-item + margin
    COPY_FEEDBACK_MS: 1500,
    FOCUS_RESTORE_DELAY_MS: 150,
    PHOTO_RESET_MS: 1500
});

const GROUP_MEMBERS = Object.freeze([
    'Gonzales, Samantha Nicole B.',
    'Manarang, Mikan M.',
    'Almario, Joyce P.',
    'Bondoc, Cassandra D.',
    'Casupanan, Rhian L.',
    'Dizon, Lynx Leonard G.'
]);

// ============================================
// STATE
// ============================================
const state = {
    cards: [],
    currentIndex: -1,
    difficulty: 'medium',
    component: 'all',
    filter: 'all'
};

// ============================================
// UTILITIES
// ============================================
const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDifficulty(d) {
    return d.charAt(0).toUpperCase() + d.slice(1);
}

function truncate(text, max = 50) {
    return text.length > max ? text.substring(0, max) + '...' : text;
}

// ============================================
// HISTORY MODULE (with virtual scrolling)
// ============================================
const history = {
    init() {
        const stored = historyStorage.load();
        if (Array.isArray(stored) && stored.length > 0) {
            state.cards = stored;
            state.currentIndex = stored.length - 1;
        }
        this.render();
    },

    save() {
        historyStorage.save(state.cards);
    },

    add(card) {
        if (state.cards.length >= CONFIG.MAX_HISTORY_SIZE) {
            throw new Error(`History limit reached (${CONFIG.MAX_HISTORY_SIZE} items). Please reset to continue.`);
        }
        state.cards.push(card);
        state.currentIndex = state.cards.length - 1;
        this.save();
        this.render();
    },

    /**
     * Remove a card by its ORIGINAL index (not visible position).
     * Adjusts currentIndex to stay pointing at the same logical card
     * (or the new last card if the removed one was at/after the current pointer).
     */
    remove(originalIndex) {
        const wasCurrentOrBefore = originalIndex <= state.currentIndex;
        state.cards.splice(originalIndex, 1);

        if (wasCurrentOrBefore) {
            // If we removed the current card, step back to the previous one
            // (which now occupies the deleted index, unless we deleted index 0).
            if (originalIndex === state.currentIndex) {
                state.currentIndex = Math.max(0, state.currentIndex - 1);
            } else {
                // Removed something before the current pointer — shift pointer back
                state.currentIndex = Math.max(0, state.currentIndex - 1);
            }
        }

        if (state.currentIndex >= state.cards.length) {
            state.currentIndex = state.cards.length - 1;
        }

        this.save();
        this.render();
    },

    clear() {
        state.cards = [];
        state.currentIndex = -1;
        historyStorage.clear();
        this.render();
    },

    setCurrent(index) {
        state.currentIndex = index;
        this.render();
    },

    toggleFavorite(index) {
        if (state.cards[index]) {
            state.cards[index].favorite = !state.cards[index].favorite;
            this.save();
            this.render();
        }
    },

    getVisible() {
        const items = state.cards.map((card, originalIndex) => ({ card, originalIndex }));
        if (state.filter === 'favorites') {
            return items.filter(({ card }) => card.favorite);
        }
        return items;
    },

    shouldUseVirtualScroll() {
        return state.cards.length > CONFIG.VIRTUAL_SCROLL_THRESHOLD;
    },

    render() {
        const list = $('#historyList');
        list.innerHTML = '';
        const visible = this.getVisible();

        if (visible.length === 0) {
            const message = state.filter === 'favorites'
                ? 'No favorites yet. Click \u2606 to add some!'
                : 'No saved lessons yet. Generate your first question!';
            list.innerHTML = `<li class="empty-state">${message}</li>`;
            return;
        }

        if (this.shouldUseVirtualScroll()) {
            this.renderVirtual(visible);
        } else {
            this.renderSimple(visible);
        }
    },

    renderSimple(visible) {
        const list = $('#historyList');
        visible.forEach(({ card, originalIndex }) => {
            list.appendChild(this.buildItem(card, originalIndex));
        });
    },

    renderVirtual(visible) {
        const list = $('#historyList');
        list.classList.add('history-list--virtual');
        const totalHeight = visible.length * CONFIG.VIRTUAL_ITEM_HEIGHT;
        list.style.height = `${totalHeight}px`;

        const renderWindow = () => {
            const scrollTop = list.scrollTop;
            const viewportHeight = list.clientHeight || 600;
            const startIndex = Math.max(0, Math.floor(scrollTop / CONFIG.VIRTUAL_ITEM_HEIGHT) - 3);
            const endIndex = Math.min(
                visible.length,
                Math.ceil((scrollTop + viewportHeight) / CONFIG.VIRTUAL_ITEM_HEIGHT) + 3
            );

            list.innerHTML = '';
            for (let i = startIndex; i < endIndex; i++) {
                const { card, originalIndex } = visible[i];
                const item = this.buildItem(card, originalIndex);
                item.style.top = `${i * CONFIG.VIRTUAL_ITEM_HEIGHT}px`;
                list.appendChild(item);
            }
        };

        // Replace listener to avoid duplicates on re-render
        list.onScrollHandler = renderWindow;
        list.addEventListener('scroll', renderWindow, { passive: true });
        renderWindow();
    },

    buildItem(card, originalIndex) {
        const isActive = originalIndex === state.currentIndex;
        const li = document.createElement('li');
        li.className = 'history-item';
        li.setAttribute('aria-current', String(isActive));
        li.dataset.originalIndex = String(originalIndex);
        li.tabIndex = 0;

        const displayIndex = state.cards.indexOf(card) + 1;

        li.innerHTML = `
            <div class="history-item__text">Q${displayIndex}: ${escapeHtml(card.label)} (${escapeHtml(card.difficulty)})</div>
            <div class="history-item__actions">
                <button class="history-item__btn history-item__btn--delete"
                        data-action="delete"
                        aria-label="Delete this lesson">\uD83D\uDDD1\uFE0F</button>
                <button class="history-item__btn history-item__btn--favorite"
                        data-action="favorite"
                        aria-pressed="${String(Boolean(card.favorite))}"
                        aria-label="${card.favorite ? 'Remove from' : 'Add to'} favorites">\u2605</button>
            </div>
        `;

        return li;
    }
};

// ============================================
// FLASHCARD MODULE
// ============================================
const flashcard = {
    elements: {
        card: null,
        frontTag: null,
        frontText: null,
        backText: null,
        loader: null,
        favoriteButtons: null
    },

    init() {
        this.elements.card = $('#flashcard');
        this.elements.frontTag = $('#frontTag');
        this.elements.frontText = $('#frontText');
        this.elements.backText = $('#backText');
        this.elements.loader = $('#flashcardLoader');
        this.elements.favoriteButtons = $$('[data-action="favorite"]');

        this.elements.card.addEventListener('click', (e) => {
            if (e.target.closest('.card-actions')) return;
            this.flip();
        });
        this.elements.card.addEventListener('keydown', (e) => {
            if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                this.flip();
            }
        });
    },

    flip() {
        if (state.currentIndex === -1) return;
        const isFlipped = this.elements.card.getAttribute('aria-flipped') === 'true';
        this.elements.card.setAttribute('aria-flipped', String(!isFlipped));
        $$('.card-face').forEach(face => {
            face.setAttribute('aria-hidden', String(isFlipped));
        });
    },

    showLoader(show) {
        this.elements.loader.setAttribute('aria-hidden', String(!show));
    },

    display(card) {
        if (!card) {
            this.elements.frontTag.textContent = 'Select Lesson';
            this.elements.frontText.textContent = 'Choose a proposal below. The panel will ask you a question about your research.';
            this.elements.backText.textContent = "The researchers' defense answer will appear here.";
            this.updateFavoriteButton(false);
            return;
        }

        this.elements.card.setAttribute('aria-flipped', 'false');
        $$('.card-face').forEach((face, i) => {
            face.setAttribute('aria-hidden', String(i !== 0));
        });

        // Small delay for the flip animation to commit
        setTimeout(() => {
            this.elements.frontTag.textContent = `${card.label} - ${formatDifficulty(card.difficulty)}`;
            this.elements.frontText.textContent = card.question;
            this.elements.backText.textContent = card.answer;
            this.updateFavoriteButton(Boolean(card.favorite));
            history.render();
        }, CONFIG.FOCUS_RESTORE_DELAY_MS);
    },

    updateFavoriteButton(isFavorited) {
        this.elements.favoriteButtons.forEach(btn => {
            btn.textContent = isFavorited ? '\u2605' : '\u2606';
            btn.setAttribute('aria-pressed', String(isFavorited));
        });
    },

    showCopyFeedback(button) {
        const original = button.textContent;
        button.textContent = '\u2713';
        setTimeout(() => { button.textContent = original; }, CONFIG.COPY_FEEDBACK_MS);
    },

    async saveAsPhoto() {
        if (state.currentIndex === -1) {
            toast.warning('Please generate a question first!');
            return;
        }

        const card = state.cards[state.currentIndex];
        $('#exportTitle').textContent = `${card.label} Defense Prep`;
        $('#exportQuestion').textContent = `Q: ${card.question}`;
        $('#exportAnswer').textContent = `A: ${card.answer}`;

        const exportZone = $('#photoExportZone');
        const photoButtons = $$('.btn-action--photo');
        photoButtons.forEach(btn => btn.textContent = '\u23F3');

        try {
            if (typeof html2canvas === 'undefined') {
                throw new Error('Image library not loaded');
            }
            const canvas = await html2canvas(exportZone, {
                backgroundColor: '#ffffff',
                scale: 2
            });
            const link = document.createElement('a');
            link.download = `ResearchDefense_Q${state.currentIndex + 1}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
            photoButtons.forEach(btn => btn.textContent = '\u2713');
            toast.success('Photo saved!');
        } catch (err) {
            console.error('Photo capture failed:', err);
            toast.error('Failed to save photo. Please try again.');
        } finally {
            setTimeout(() => {
                photoButtons.forEach(btn => btn.textContent = '\uD83D\uDCF7');
            }, CONFIG.PHOTO_RESET_MS);
        }
    },

    copyText(side) {
        if (state.currentIndex === -1) return;
        const card = state.cards[state.currentIndex];
        const text = side === 'front' ? `Q: ${card.question}` : `A: ${card.answer}`;

        if (!navigator.clipboard) {
            toast.error('Clipboard not available in this browser');
            return;
        }

        navigator.clipboard.writeText(text).then(() => {
            const selector = side === 'front' ? '[data-action="copy-front"]' : '[data-action="copy-back"]';
            const button = $(selector);
            if (button) this.showCopyFeedback(button);
            toast.success('Copied to clipboard');
        }).catch(err => {
            console.error('Copy failed:', err);
            toast.error('Failed to copy text to clipboard.');
        });
    },

    toggleFavorite() {
        if (state.currentIndex === -1) return;
        const card = state.cards[state.currentIndex];
        card.favorite = !card.favorite;
        history.save();
        this.updateFavoriteButton(card.favorite);
        history.render();
    }
};

// ============================================
// SIDEBAR MODULE
// ============================================
const sidebar = {
    isOpen: false,

    init() {
        $('#sidebarToggle').addEventListener('click', () => this.toggle());
        $('#sidebarClose').addEventListener('click', () => this.close());
        $('#sidebarOverlay').addEventListener('click', () => this.close());

        $$('[data-filter]').forEach(btn => {
            btn.addEventListener('click', () => this.setFilter(btn.dataset.filter));
        });

        $('#historyList').addEventListener('click', (e) => this.handleListClick(e));
        $('#historyList').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                const item = e.target.closest('.history-item');
                if (item) {
                    e.preventDefault();
                    this.handleListClick({ target: item });
                }
            }
        });
    },

    open() {
        this.isOpen = true;
        $('#sidebar').setAttribute('aria-hidden', 'false');
        $('#sidebarOverlay').setAttribute('aria-hidden', 'false');
        $('#sidebarToggle').setAttribute('aria-expanded', 'true');
    },

    close() {
        this.isOpen = false;
        $('#sidebar').setAttribute('aria-hidden', 'true');
        $('#sidebarOverlay').setAttribute('aria-hidden', 'true');
        $('#sidebarToggle').setAttribute('aria-expanded', 'false');
    },

    toggle() {
        this.isOpen ? this.close() : this.open();
    },

    setFilter(filter) {
        state.filter = filter;
        $$('[data-filter]').forEach(btn => {
            const isActive = btn.dataset.filter === filter;
            btn.setAttribute('aria-pressed', String(isActive));
        });
        history.render();
    },

    handleListClick(e) {
        const item = e.target.closest('.history-item');
        if (!item) return;
        const index = Number(item.dataset.originalIndex);
        if (Number.isNaN(index)) return;

        const actionBtn = e.target.closest('[data-action]');
        if (actionBtn) {
            e.stopPropagation();
            const action = actionBtn.dataset.action;
            if (action === 'delete') {
                modal.show(
                    'Delete Lesson',
                    'Are you sure you want to delete this flashcard?',
                    () => {
                        history.remove(index);
                        if (state.cards[state.currentIndex]) {
                            flashcard.display(state.cards[state.currentIndex]);
                        } else {
                            flashcard.display(null);
                        }
                    }
                );
            } else if (action === 'favorite') {
                history.toggleFavorite(index);
                if (index === state.currentIndex && state.cards[index]) {
                    flashcard.updateFavoriteButton(state.cards[index].favorite);
                }
            }
            return;
        }

        if (state.cards[index]) {
            history.setCurrent(index);
            flashcard.display(state.cards[index]);
            if (window.innerWidth < 768) this.close();
        }
    }
};

// ============================================
// MODAL MODULE
// ============================================
const modal = {
    currentCallback: null,

    init() {
        $('#confirmCancel').addEventListener('click', () => this.close());
        $('#confirmAction').addEventListener('click', () => this.confirm());
        $('#confirmModal').addEventListener('click', (e) => {
            if (e.target.id === 'confirmModal') this.close();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen()) this.close();
        });
    },

    isOpen() {
        return $('#confirmModal').getAttribute('aria-hidden') === 'false';
    },

    show(title, message, onConfirm) {
        $('#confirmTitle').textContent = title;
        $('#confirmMessage').textContent = message;
        this.currentCallback = onConfirm;
        $('#confirmModal').setAttribute('aria-hidden', 'false');
        $('#confirmCancel').focus();
    },

    close() {
        $('#confirmModal').setAttribute('aria-hidden', 'true');
        this.currentCallback = null;
    },

    confirm() {
        const callback = this.currentCallback;
        this.close();
        if (typeof callback === 'function') callback();
    }
};

// ============================================
// DARK MODE MODULE
// ============================================
const darkMode = {
    init() {
        const stored = themeStorage.load();
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        const theme = stored || (prefersDark ? 'dark' : 'light');
        this.apply(theme);

        $('#darkModeToggle').addEventListener('click', () => this.toggle());

        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
            if (!themeStorage.load()) {
                this.apply(e.matches ? 'dark' : 'light');
            }
        });
    },

    apply(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        const toggle = $('#darkModeToggle');
        if (toggle) {
            toggle.setAttribute('aria-pressed', String(theme === 'dark'));
            toggle.textContent = theme === 'dark' ? '\u2600\uFE0F' : '\uD83C\uDF19';
        }
    },

    toggle() {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        this.apply(next);
        themeStorage.save(next);
    }
};

// ============================================
// PDF EXPORT MODULE
// ============================================
const pdfExport = {
    export() {
        if (state.cards.length === 0) {
            toast.warning('No flashcards to export!');
            return;
        }
        if (typeof window.jspdf === 'undefined') {
            toast.error('PDF library not loaded');
            return;
        }

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        const pageHeight = doc.internal.pageSize.height;
        const margin = 20;
        const maxWidth = 170;
        let y = 20;

        const addText = (text, fontSize = 12, isBold = false) => {
            doc.setFontSize(fontSize);
            if (isBold) doc.setFont(undefined, 'bold');
            else doc.setFont(undefined, 'normal');
            const lines = doc.splitTextToSize(text, maxWidth);

            lines.forEach(line => {
                if (y > pageHeight - margin) {
                    doc.addPage();
                    y = margin;
                }
                doc.text(line, margin, y);
                y += fontSize * 0.5;
            });
            y += 3;
        };

        addText('Research Defense Practice', 18, true);
        addText(`Exported: ${new Date().toLocaleDateString()}`, 10);
        y += 5;

        addText('Group Members:', 14, true);
        GROUP_MEMBERS.forEach(m => addText(m, 11));
        y += 10;

        state.cards.forEach((card, index) => {
            if (y > pageHeight - 80) { doc.addPage(); y = margin; }

            addText(`FLASHCARD ${index + 1}`, 14, true);
            addText(`Topic: ${card.label} | Difficulty: ${card.difficulty}`, 10);
            addText(`Generated: ${new Date(card.timestamp).toLocaleString()}`, 10);
            addText(`Favorite: ${card.favorite ? 'Yes' : 'No'}`, 10);
            y += 3;

            addText('QUESTION:', 12, true);
            addText(card.question, 11);
            y += 3;

            addText('ANSWER:', 12, true);
            addText(card.answer, 11);
            y += 10;
        });

        doc.save(`research-defense-practice-${new Date().toISOString().slice(0, 10)}.pdf`);
        toast.success('PDF exported successfully');
    }
};

// ============================================
// INTERROGATION (Main Action)
// ============================================
async function triggerInterrogation(proposalId) {
    const button = $(`[data-proposal="${proposalId}"]`);
    if (button) button.disabled = true;
    flashcard.showLoader(true);

    try {
        const proposal = await researchData.load(proposalId);
        const content = await api.generateQuestion(
            state.difficulty,
            state.component,
            proposal.dataDump,
            RESEARCH_COMPONENTS
        );

        const parsed = api.parseJSON(content);

        if (!parsed.question || !parsed.answer) {
            throw new Error('Invalid response structure');
        }

        const card = {
            id: Date.now(),
            label: truncate(proposal.title),
            question: parsed.question,
            answer: parsed.answer,
            difficulty: state.difficulty,
            component: state.component,
            timestamp: new Date().toISOString(),
            favorite: false
        };

        history.add(card);
        flashcard.display(card);
        toast.success('Question generated!');
    } catch (err) {
        if (err.name === 'AbortError') return;
        console.error('Interrogation error:', err);
        toast.error(`Failed to generate question: ${err.message}`);
    } finally {
        if (button) button.disabled = false;
        flashcard.showLoader(false);
    }
}

// ============================================
// EVENT WIRING
// ============================================
function wireEvents() {
    $$('[data-difficulty]').forEach(btn => {
        btn.addEventListener('click', () => {
            state.difficulty = btn.dataset.difficulty;
            $$('[data-difficulty]').forEach(b => {
                b.setAttribute('aria-pressed', String(b === btn));
            });
        });
    });

    $('#componentDropdown').addEventListener('change', (e) => {
        state.component = e.target.value;
    });

    $$('[data-proposal]').forEach(btn => {
        btn.addEventListener('click', () => triggerInterrogation(btn.dataset.proposal));
    });

    // Delegated handler for card actions (photo, copy, favorite)
    document.addEventListener('click', (e) => {
        const actionBtn = e.target.closest('[data-action]');
        if (!actionBtn) return;

        e.stopPropagation();
        const action = actionBtn.dataset.action;
        switch (action) {
            case 'photo': flashcard.saveAsPhoto(); break;
            case 'copy-front': flashcard.copyText('front'); break;
            case 'copy-back': flashcard.copyText('back'); break;
            case 'favorite': flashcard.toggleFavorite(); break;
        }
    });

    $('#resetBtn').addEventListener('click', () => {
        modal.show(
            'Warning',
            'Are you sure you want to delete all your saved lessons? This cannot be undone.',
            () => {
                history.clear();
                flashcard.display(null);
                sidebar.close();
                toast.info('All lessons cleared');
            }
        );
    });

    $('#exportBtn').addEventListener('click', () => pdfExport.export());
}

// ============================================
// INITIALIZATION
// ============================================
window.addEventListener('DOMContentLoaded', () => {
    toast.init();
    darkMode.init();
    history.init();
    flashcard.init();
    sidebar.init();
    modal.init();
    wireEvents();

    if (state.currentIndex !== -1 && state.cards[state.currentIndex]) {
        flashcard.display(state.cards[state.currentIndex]);
    }
});

window.addEventListener('load', () => {
    setTimeout(() => {
        const intro = $('#introLoader');
        if (intro) intro.setAttribute('hidden', '');
    }, 2500);

    // Register service worker for offline support (production only)
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
        navigator.serviceWorker.register('sw.js').catch(err => {
            console.warn('Service worker registration failed:', err);
        });
    }
});

// Export for testing in module-aware environments
if (typeof window !== 'undefined') {
    window.appState = state;
    window.CONFIG = CONFIG;
    window.GROUP_MEMBERS = GROUP_MEMBERS;
    window.history = history;
    window.flashcard = flashcard;
    window.sidebar = sidebar;
    window.modal = modal;
    window.darkMode = darkMode;
    window.pdfExport = pdfExport;
    window.triggerInterrogation = triggerInterrogation;
}

/**
 * Chatbot module - messaging logic with the research assistant
 * Depends on: storage.js, toast.js, api.js, data.js
 */

const CHATBOT_CONFIG = Object.freeze({
    MAX_PERSISTED_MESSAGES: 100
});

const chatbot = {
    isOpen: false,
    history: [],

    init() {
        $('#chatbotToggle').addEventListener('click', () => this.toggle());
        $('#chatbotClose').addEventListener('click', () => this.close());
        $('#chatbotForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.send();
        });

        this.history = chatStorage.load();
        if (!Array.isArray(this.history)) this.history = [];
        this.renderHistory();
    },

    open() {
        this.isOpen = true;
        $('#chatbotPopup').setAttribute('aria-hidden', 'false');
        $('#chatbotToggle').setAttribute('aria-expanded', 'true');
    },

    close() {
        this.isOpen = false;
        $('#chatbotPopup').setAttribute('aria-hidden', 'true');
        $('#chatbotToggle').setAttribute('aria-expanded', 'false');
    },

    toggle() {
        this.isOpen ? this.close() : this.open();
    },

    addMessage(content, sender) {
        const container = $('#chatbotMessages');
        const div = document.createElement('div');
        div.className = `message ${sender}-message`;
        div.textContent = content;
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
        return div;
    },

    renderHistory() {
        const container = $('#chatbotMessages');
        container.innerHTML = '';
        this.addMessage("Hello! I'm your research assistant. How can I help you today?", 'bot');
        this.history.forEach(msg => {
            this.addMessage(msg.content, msg.role === 'user' ? 'user' : 'bot');
        });
    },

    persist() {
        // Trim to most recent N messages
        if (this.history.length > CHATBOT_CONFIG.MAX_PERSISTED_MESSAGES) {
            this.history = this.history.slice(-CHATBOT_CONFIG.MAX_PERSISTED_MESSAGES);
        }
        chatStorage.save(this.history);
    },

    async send() {
        const input = $('#chatbotInput');
        const message = input.value.trim();
        if (!message) return;

        input.value = '';
        this.addMessage(message, 'user');
        this.history.push({ role: 'user', content: message });

        const typingIndicator = this.addMessage('...', 'bot');

        try {
            // Use proposal 1 as the chat context (only one currently loaded)
            const proposal = await researchData.load('1');
            const response = await api.chat(message, proposal.dataDump);

            typingIndicator.remove();
            this.addMessage(response, 'bot');
            this.history.push({ role: 'assistant', content: response });
            this.persist();
        } catch (err) {
            if (err.name === 'AbortError') return;
            typingIndicator.remove();
            this.addMessage("Sorry, I'm having trouble connecting to the AI service.", 'bot');
            console.error('Chatbot error:', err);
            toast.error('Chat request failed. Please try again.');
        }
    },

    clear() {
        this.history = [];
        chatStorage.clear();
        this.renderHistory();
        toast.info('Chat history cleared');
    }
};

if (typeof window !== 'undefined') {
    window.chatbot = chatbot;
    window.CHATBOT_CONFIG = CHATBOT_CONFIG;
}

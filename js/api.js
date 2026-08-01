/**
 * API layer - centralized fetch helper for /api/chat
 * Handles question generation and chatbot messaging
 */

const API_CONFIG = Object.freeze({
    ENDPOINT: '/api/chat',
    TIMEOUT_MS: 30000
});

const api = {
    pendingRequest: null,

    /**
     * Generate a defense question for a specific difficulty/component
     */
    async generateQuestion(difficulty, component, context, components) {
        const difficultyPrompts = {
            easy: "Create a basic question focusing on fundamental concepts and data.",
            medium: "Create a moderate question that tests understanding of methodology and application of research data.",
            hard: "Create a challenging question that requires critical analysis of research findings and data interpretation."
        };

        const componentObj = component === 'all'
            ? components[Math.floor(Math.random() * components.length)]
            : components.find(c => c.key === component) || { name: 'Research Proposal' };

        const prompt = `You are a strict, highly critical Senior High School research panel defense judge. Your sole source of absolute truth is the research proposal provided below.

CRITICAL EXECUTION PROTOCOLS:
1. TRUST THE DATA: When evaluating a question, you must read all sections of the matching proposal.
2. EXTRACTION OVER GUESSING: If the information is present or clearly implied, extract it. Do NOT guess outside information.
3. NO LAZY REFUSALS: You are prohibited from responding with "This information is not explicitly detailed" if the answer can be synthesized from the text.
4. QUESTION FORMAT: Frame questions as if directly asking the researchers (e.g., "What sampling method did you use?")
5. ANSWER FORMAT: Frame answers in third person plural ('The researchers...')
6. CONTEXTUAL LIMITATION: ONLY use information from the provided research proposal
7. RESPONSE FORMAT: Provide ONLY valid JSON: {"question": "...", "answer": "..."}

RESEARCH PROPOSAL:
${context}

${difficultyPrompts[difficulty]} Focus specifically on the ${componentObj.name} of the research proposal. As a panelist, ask a short, direct, and specific question. Provide the question and answer in JSON format.`;

        return this.call(prompt);
    },

    /**
     * Send a chat message to the research assistant
     */
    async chat(message, context) {
        const prompt = `You are a helpful research assistant for a project titled "The Relationship Between AI-Assisted Learning Tools and the Academic Performance of Students".

User message: "${message}"

Instructions:
1. Respond directly as a helpful assistant
2. Use "I" and "you" language, not third person
3. Only discuss the research project when relevant
4. Keep responses concise and helpful
5. Don't volunteer information unless asked
6. Respond naturally to general conversation too

Respond directly to the user's message:`;
        return this.call(prompt);
    },

    /**
     * Low-level fetch wrapper with abort + timeout support
     */
    async call(prompt) {
        if (this.pendingRequest) {
            this.pendingRequest.abort();
        }

        const controller = new AbortController();
        this.pendingRequest = controller;

        // Timeout safety net
        const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.TIMEOUT_MS);

        try {
            const response = await fetch(API_CONFIG.ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt }),
                signal: controller.signal
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.error || `HTTP ${response.status}`);
            }

            const data = await response.json();
            const content = data?.choices?.[0]?.message?.content;

            if (!content) {
                throw new Error('Empty response from AI service');
            }

            return content;
        } finally {
            clearTimeout(timeoutId);
            if (this.pendingRequest === controller) {
                this.pendingRequest = null;
            }
        }
    },

    /**
     * Parse JSON from AI response, tolerating code-fenced JSON
     */
    parseJSON(content) {
        if (typeof content !== 'string') {
            throw new Error('Invalid content type');
        }

        // Strip markdown code fences if present
        const fenced = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
        if (fenced) {
            try { return JSON.parse(fenced[1]); } catch { /* fall through */ }
        }

        try {
            return JSON.parse(content);
        } catch {
            const match = content.match(/\{[\s\S]*\}/);
            if (match) {
                try {
                    return JSON.parse(match[0]);
                } catch {
                    throw new Error('AI response was not valid JSON');
                }
            }
            throw new Error('AI response was not valid JSON');
        }
    }
};

if (typeof window !== 'undefined') {
    window.api = api;
    window.API_CONFIG = API_CONFIG;
}

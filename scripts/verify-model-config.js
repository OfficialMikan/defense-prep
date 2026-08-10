// Verify GPT model configuration in api/chat.js.
const fs = require('fs');
const chat = fs.readFileSync('api/chat.js', 'utf8');

const checks = {
    openai_chatbot_model: chat.includes("OPENAI_CHATBOT_MODEL = process.env.OPENAI_CHATBOT_MODEL || 'gpt-4.1-mini'"),
    openai_chatbot_fallback_model: chat.includes("OPENAI_CHATBOT_FALLBACK_MODEL = process.env.OPENAI_CHATBOT_FALLBACK_MODEL || 'gpt-4.1-nano'"),
    openai_flashcard_model: chat.includes("OPENAI_FLASHCARD_MODEL = process.env.OPENAI_FLASHCARD_MODEL || 'gpt-4.1-mini'"),
    openai_flashcard_fallback_model: chat.includes("OPENAI_FLASHCARD_FALLBACK_MODEL = process.env.OPENAI_FLASHCARD_FALLBACK_MODEL || 'gpt-4.1-nano'"),
    chatbot_model: chat.includes("CHATBOT_MODEL = process.env.GROQ_CHATBOT_MODEL || 'llama-3.1-8b-instant'"),
    chatbot_fallback_model: chat.includes("CHATBOT_FALLBACK_MODEL = process.env.GROQ_CHATBOT_FALLBACK_MODEL || 'llama-3.3-70b-versatile'"),
    flashcard_model: chat.includes("FLASHCARD_MODEL = process.env.GROQ_FLASHCARD_MODEL || 'llama-3.1-8b-instant'"),
    flashcard_fallback_model: chat.includes("FLASHCARD_FALLBACK_MODEL = process.env.GROQ_FLASHCARD_FALLBACK_MODEL || 'llama-3.3-70b-versatile'")
};

const fails = Object.entries(checks).filter(([, v]) => !v);
console.log('Model config:', fails.length === 0 ? 'ALL PASS' : ('FAIL: ' + fails.map(([k]) => k).join(', ')));
process.exit(fails.length ? 1 : 0);

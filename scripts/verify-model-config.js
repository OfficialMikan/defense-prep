// Verify GPT model configuration in api/chat.js.
const fs = require('fs');
const chat = fs.readFileSync('api/chat.js', 'utf8');

const checks = {
    openai_chatbot_model: chat.includes("OPENAI_CHATBOT_MODEL = process.env.OPENAI_CHATBOT_MODEL || 'gpt-4.1-mini'"),
    openai_chatbot_fallback_model: chat.includes("OPENAI_CHATBOT_FALLBACK_MODEL = process.env.OPENAI_CHATBOT_FALLBACK_MODEL || 'gpt-4.1-nano'"),
    openai_flashcard_model: chat.includes("OPENAI_FLASHCARD_MODEL = process.env.OPENAI_FLASHCARD_MODEL || 'gpt-4.1-mini'"),
    openai_flashcard_fallback_model: chat.includes("OPENAI_FLASHCARD_FALLBACK_MODEL = process.env.OPENAI_FLASHCARD_FALLBACK_MODEL || 'gpt-4.1-nano'"),
    chatbot_model: chat.includes("CHATBOT_MODEL = process.env.GROQ_CHATBOT_MODEL || 'openai/gpt-oss-120b'"),
    chatbot_fallback_model: chat.includes("CHATBOT_FALLBACK_MODEL = process.env.GROQ_CHATBOT_FALLBACK_MODEL || 'openai/gpt-oss-20b'"),
    flashcard_model: chat.includes("FLASHCARD_MODEL = process.env.GROQ_FLASHCARD_MODEL || 'openai/gpt-oss-120b'"),
    flashcard_fallback_model: chat.includes("FLASHCARD_FALLBACK_MODEL = process.env.GROQ_FLASHCARD_FALLBACK_MODEL || 'openai/gpt-oss-20b'")
};

const fails = Object.entries(checks).filter(([, v]) => !v);
console.log('Model config:', fails.length === 0 ? 'ALL PASS' : ('FAIL: ' + fails.map(([k]) => k).join(', ')));
process.exit(fails.length ? 1 : 0);

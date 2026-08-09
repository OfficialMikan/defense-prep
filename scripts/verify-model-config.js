// Verify GPT model + reasoning effort configuration in api/chat.js.
const fs = require('fs');
const chat = fs.readFileSync('api/chat.js', 'utf8');

const checks = {
    chatbot_model: chat.includes("CHATBOT_MODEL = process.env.GROQ_CHATBOT_MODEL || 'openai/gpt-oss-120b'"),
    chatbot_fallback_model: chat.includes("CHATBOT_FALLBACK_MODEL = process.env.GROQ_CHATBOT_FALLBACK_MODEL || 'openai/gpt-oss-120b'"),
    flashcard_model: chat.includes("FLASHCARD_MODEL = process.env.GROQ_FLASHCARD_MODEL || 'openai/gpt-oss-120b'"),
    flashcard_fallback_model: chat.includes("FLASHCARD_FALLBACK_MODEL = process.env.GROQ_FLASHCARD_FALLBACK_MODEL || 'openai/gpt-oss-120b'"),
    chatbot_reasoning: chat.includes("CHATBOT_REASONING_EFFORT = process.env.CHATBOT_REASONING_EFFORT || 'medium'"),
    flashcard_reasoning: chat.includes("FLASHCARD_REASONING_EFFORT = process.env.FLASHCARD_REASONING_EFFORT || 'low'")
};

const fails = Object.entries(checks).filter(([, v]) => !v);
console.log('Model config:', fails.length === 0 ? 'ALL PASS' : ('FAIL: ' + fails.map(([k]) => k).join(', ')));
process.exit(fails.length ? 1 : 0);
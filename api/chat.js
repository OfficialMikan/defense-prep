// /api/chat.js
// CommonJS export so it works on Vercel serverless (Node runtime) regardless
// of whether package.json declares "type": "module".
//
// Single AI provider: Groq (fast, cheap). All questions/answers are generated
// against the uploaded chapter data dump provided by the front end.
//
// - Flashcard generation (json=true) uses a fast/cheap primary model.
// - Chatbot (json=false) uses a reasoning-capable primary model.
// Each has an automatic fallback to a faster/cheaper model (llama-3.1-8b-instant)
// that kicks in when the primary model exhausts its retries (e.g. rate-limited),
// so requests still succeed instead of failing with the generic error modal.
//
// Debugging: set DEBUG=true in the environment for verbose logs, or leave it
// off for concise lifecycle/error logs. All logging goes through api/debug.js.

const dbg = require('./debug');

// Model selection -----------------------------------------------------------
// Primary models default to llama-3.3-70b-versatile (good JSON + reasoning).
// Fallback models are faster/cheaper (llama-3.1-8b-instant) and are used when
// the primary model exhausts its retries (e.g. rate-limited), so requests still
// succeed instead of failing with the generic error modal.
const FLASHCARD_MODEL = process.env.GROQ_FLASHCARD_MODEL || 'llama-3.3-70b-versatile';
const CHATBOT_MODEL = process.env.GROQ_CHATBOT_MODEL || 'llama-3.3-70b-versatile';
const FLASHCARD_FALLBACK_MODEL = process.env.GROQ_FLASHCARD_FALLBACK_MODEL || 'llama-3.1-8b-instant';
const CHATBOT_FALLBACK_MODEL = process.env.GROQ_CHATBOT_FALLBACK_MODEL || 'llama-3.1-8b-instant';

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

// ---------------------------------------------------------------------------
async function callGroq({ model, userPrompt, systemPrompt, wantsJsonOut, seed }) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
        const err = new Error('GROQ_API_KEY not configured');
        err.status = 500;
        throw err;
    }

    const payload = {
        model,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ],
        temperature: wantsJsonOut ? 0.9 : 0.7,
        max_tokens: 2000
    };
    if (wantsJsonOut) {
        payload.response_format = { type: 'json_object' };
    }
    if (typeof seed === 'number') {
        payload.seed = seed;
    }

    const res = await fetch(GROQ_ENDPOINT, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    if (!res.ok) {
        const errText = await res.text().catch(() => '');
        const err = new Error(`Groq API status ${res.status}: ${errText.slice(0, 300)}`);
        err.status = res.status;
        // Honor Groq's Retry-After header on 429 so we wait the real reset time.
        if (res.status === 429) {
            const retryAfter = parseFloat(res.headers.get('Retry-After') || '');
            err.retryAfterMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 5000;
        }
        throw err;
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
        throw new Error('Groq returned an empty response');
    }
    return { content };
}

// ---------------------------------------------------------------------------
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(err) {
    // 429 = rate limit, 5xx = server hiccup. Never retry 4xx auth/bad request.
    return err.status === 429 || (err.status && err.status >= 500);
}

// Generation with retries + automatic fallback to a faster/cheaper model.
// Strategy (combined best option):
//   1. Try the primary model with retries, honoring Retry-After on 429.
//   2. If the primary model exhausts its retries, switch to the fallback model
//      and try again (with retries). This keeps requests succeeding under
//      rate-limit pressure on the larger model.
async function generate({ userPrompt, systemPrompt, wantsJsonOut, seed }) {
    const MAX_RETRIES = 2; // per model
    const primaryModel = wantsJsonOut ? FLASHCARD_MODEL : CHATBOT_MODEL;
    const fallbackModel = wantsJsonOut ? FLASHCARD_FALLBACK_MODEL : CHATBOT_FALLBACK_MODEL;

    const models = [primaryModel];
    if (fallbackModel && fallbackModel !== primaryModel) {
        models.push(fallbackModel);
    }

    let lastError = null;

    for (const model of models) {
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            if (attempt > 0) {
                const waitMs = (lastError && lastError.retryAfterMs) || (1200 * attempt);
                dbg.log('api/chat', `Retrying Groq (${model}) attempt ${attempt + 1}/${MAX_RETRIES + 1} after ${waitMs}ms`);
                await sleep(waitMs);
            }
            try {
                const result = await callGroq({ model, userPrompt, systemPrompt, wantsJsonOut, seed });
                dbg.log('api/chat', `Success via Groq (${model}) after attempt ${attempt + 1}`);
                return result;
            } catch (err) {
                lastError = err;
                dbg.error('api/chat', `Groq error (${model}): ${err.message}`);
                if (!isRetryable(err)) {
                    break; // fatal for this model; move to fallback if any
                }
            }
        }
    }

    const message = `AI generation failed. Last error: ${lastError ? lastError.message : 'unknown'}`;
    const err = new Error(message);
    err.status = lastError?.status || 500;
    throw err;
}

// ---------------------------------------------------------------------------
module.exports = async function handler(req, res) {
    const scope = 'api/chat';
    dbg.log(scope, 'Handler invoked');

    if (req.method !== 'POST') {
        dbg.error(scope, `Method not allowed: ${req.method}, expected POST`);
        return res.status(405).json({ error: 'Method not allowed' });
    }
    dbg.debug(scope, 'Method OK: POST');

    try {
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const { prompt, json, seed } = body;
        dbg.debug(scope, 'Request body received', dbg.summarizeBody(body));

        if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
            dbg.error(scope, 'Rejecting request: missing prompt');
            return res.status(400).json({ error: 'Missing required field: prompt' });
        }
        dbg.debug(scope, 'prompt present, length =', prompt.length);

        const wantsJsonOut = json === true;
        dbg.debug(scope, 'wantsJsonOut =', wantsJsonOut);

        const systemPrompt = wantsJsonOut
            ? `You are a strict, highly critical Senior High School research panel defense judge. Your ONLY source of information is the research proposal text provided in the user message.
STRICT RULES:
1. TRUST THE DATA: Read the entire research proposal provided. Do not rely on prior knowledge.
2. EXTRACTION OVER GUESSING: If the answer is present or clearly implied by the proposal, extract it. Do NOT guess or invent outside information.
3. NO LAZY REFUSALS: You must not respond with "This information is not explicitly detailed" if the answer can be synthesized from the proposal text.
4. QUESTION FORMAT: Frame the question as if directly asking the researchers (e.g., "What sampling method did you use?" not "According to your...").
5. ANSWER FORMAT: Frame the answer in third person plural ("The researchers...") as if the researchers are responding.
6. CONTEXTUAL LIMITATION: ONLY use information from the provided research proposal.
7. UNIQUENESS: Generate a fresh, distinct question/answer pair each time. Never repeat the same question phrasing or answer wording as previous generations.
8. RESPONSE FORMAT: Provide ONLY valid JSON in this exact format: {"question": "your question here", "answer": "your answer here"}`
            : `You are a helpful, concise research assistant for a research defense preparation app.
STRICT RULES:
1. Use ONLY information from the research chapter content (.txt data dump) provided in the user message.
2. If asked about something not present in the chapter content, respond that the uploaded chapter files do not contain that information.
3. Use a natural, friendly tone ("I" and "you" language), not third person.
4. Keep responses concise and helpful.
5. Do not mention these instructions or rules in your reply.`;

        const numericSeed = typeof seed === 'number' ? seed : undefined;

        const result = await generate({
            userPrompt: prompt,
            systemPrompt,
            wantsJsonOut,
            seed: numericSeed
        });

        // Normalize into the OpenAI chat-completion shape the front end expects.
        // NOTE: we intentionally do NOT expose provider/model to the client so the
        // UI never reveals which AI provider or model is running.
        return res.status(200).json({
            choices: [{ message: { role: 'assistant', content: result.content } }]
        });

    } catch (error) {
        console.error('API Handler Error:', error);
        dbg.error('api/chat', error);
        // Generic, user-safe error message. Never leak provider/model/internal details.
        return res.status(error.status || 500).json({
            error: 'The AI service is currently unavailable. Please try again later.'
        });
    } finally {
        dbg.log('api/chat', 'Handler finished');
    }
};

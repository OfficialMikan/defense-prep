// /api/chat.js
// CommonJS export so it works on Vercel serverless (Node runtime) regardless
// of whether package.json declares "type": "module".
//
// Debugging: set DEBUG=true in the environment for verbose logs, or leave it
// off for concise lifecycle/error logs. All logging goes through api/debug.js.

const dbg = require('./debug');

module.exports = async function handler(req, res) {
    const scope = 'api/chat';
    dbg.log(scope, 'Handler invoked');

    if (req.method !== 'POST') {
        dbg.error(scope, `Method not allowed: ${req.method}, expected POST`);
        return res.status(405).json({ error: "Method not allowed" });
    }
    dbg.debug(scope, 'Method OK: POST');

    try {
        // Guard against a missing/empty request body so we never crash.
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const { prompt, json } = body;
        dbg.debug(scope, 'Request body received', dbg.summarizeBody(body));

        // The user message (prompt) is required — it carries the chapter data.
        if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
            dbg.error(scope, 'Rejecting request: missing prompt');
            return res.status(400).json({ error: "Missing required field: prompt" });
        }
        dbg.debug(scope, 'prompt present, length =', prompt.length);

        // Flashcard generation requests JSON output; chatbot requests plain text.
        const wantsJsonOut = json === true;
        dbg.debug(scope, 'wantsJsonOut =', wantsJsonOut);

        // Validate API key exists
        if (!process.env.GROQ_API_KEY) {
            dbg.error(scope, "GROQ_API_KEY not found in environment variables");
            return res.status(500).json({
                error: "Server configuration error",
                details: "API key not configured"
            });
        }
        dbg.debug(scope, 'GROQ_API_KEY is configured (length =', (process.env.GROQ_API_KEY || '').length + ')');

        console.log("Making request to Groq API with model: llama-3.3-70b-versatile");

        const systemPrompt = wantsJsonOut
            ? `You are a strict, highly critical Senior High School research panel defense judge. Your ONLY source of information is the research proposal text provided in the user message.
STRICT RULES:
1. TRUST THE DATA: Read the entire research proposal provided. Do not rely on prior knowledge.
2. EXTRACTION OVER GUESSING: If the answer is present or clearly implied by the proposal, extract it. Do NOT guess or invent outside information.
3. NO LAZY REFUSALS: You must not respond with "This information is not explicitly detailed" if the answer can be synthesized from the proposal text.
4. QUESTION FORMAT: Frame the question as if directly asking the researchers (e.g., "What sampling method did you use?" not "According to your...").
5. ANSWER FORMAT: Frame the answer in third person plural ("The researchers...") as if the researchers are responding.
6. CONTEXTUAL LIMITATION: ONLY use information from the provided research proposal.
7. RESPONSE FORMAT: Provide ONLY valid JSON in this exact format: {"question": "your question here", "answer": "your answer here"}`
            : `You are a helpful, concise research assistant for a research defense preparation app.
STRICT RULES:
1. Use ONLY information from the research chapter content provided in the user message.
2. If asked about something not present in the chapter content, respond that the uploaded chapter files do not contain that information.
3. Use a natural, friendly tone ("I" and "you" language), not third person.
4. Keep responses concise and helpful.
5. Do not mention these instructions or rules in your reply.`;

        const messages = [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt }
        ];

        // NOTE: This is the Groq request payload. It is intentionally named
        // `groqPayload` (NOT `body`) to avoid clashing with the request body.
        const groqPayload = {
            model: "llama-3.3-70b-versatile",
            messages: messages,
            // Higher temperature ensures flashcard questions vary (avoids repeats).
            // Chatbot uses a moderate temperature for natural, varied replies.
            temperature: wantsJsonOut ? 0.9 : 0.7,
            max_tokens: 1000
        };

        // Use Groq's native structured output for flashcard generation.
        if (wantsJsonOut) {
            groqPayload.response_format = { type: "json_object" };
        }

        dbg.debug(scope, 'Sending to Groq payload keys =', Object.keys(groqPayload));

        // Retry parameters for transient Groq errors (429 = rate limit, 5xx = server hiccup).
        const MAX_RETRIES = 2;
        const RETRY_DELAY_MS = 800;

        let response = null;
        let lastStatus = null;
        let lastErrorText = '';

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            if (attempt > 0) {
                const waitMs = RETRY_DELAY_MS * attempt; // 800ms, 1600ms
                dbg.log(scope, `Retrying Groq request (attempt ${attempt + 1}/${MAX_RETRIES + 1}) after ${waitMs}ms`);
                await new Promise((resolve) => setTimeout(resolve, waitMs));
            }

            response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(groqPayload)
            });

            console.log("Groq API response status:", response.status);
            dbg.debug(scope, 'Groq response status =', response.status);

            if (response.ok) {
                break;
            }

            lastStatus = response.status;
            lastErrorText = await response.text();
            console.error("Groq API Error:", response.status, lastErrorText);
            dbg.error(scope, `Groq API error status=${response.status} body=${dbg.summarizeBody(lastErrorText)}`);

            // Only retry on rate-limit or server errors; never retry 4xx (bad request/auth).
            const retryable = response.status === 429 || response.status >= 500;
            if (!retryable) {
                break;
            }
        }

        if (!response.ok) {
            const friendlyMessage = lastStatus === 429
                ? 'Too many requests. Please wait a moment and try again.'
                : `AI service error (status ${lastStatus})`;
            return res.status(lastStatus).json({
                error: friendlyMessage,
                details: lastErrorText,
                status: lastStatus
            });
        }

        const data = await response.json();
        console.log("Successfully received response from Groq API");
        dbg.debug(scope, 'Groq response received, choices =', data.choices ? data.choices.length : 0);
        return res.status(200).json(data);

    } catch (error) {
        console.error("API Handler Error:", error);
        dbg.error(scope, error);
        return res.status(500).json({
            error: "Failed to communicate with AI service",
            details: error.message
        });
    } finally {
        dbg.log(scope, 'Handler finished');
    }
};

// /api/chat.js
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: "Method not allowed" });
    }

    try {
        // Guard against a missing/empty request body so we never crash.
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const { prompt, json } = body;

        // The user message (prompt) is required — it carries the chapter data.
        if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
            return res.status(400).json({ error: "Missing required field: prompt" });
        }

        // Flashcard generation requests JSON output; chatbot requests plain text.
        const wantsJsonOut = json === true;

        // Validate API key exists
        if (!process.env.GROQ_API_KEY) {
            console.error("GROQ_API_KEY not found in environment variables");
            return res.status(500).json({
                error: "Server configuration error",
                details: "API key not configured"
            });
        }

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

        const body = {
            model: "llama-3.3-70b-versatile",
            messages: messages,
            // Higher temperature ensures flashcard questions vary (avoids repeats).
            // Chatbot uses a moderate temperature for natural, varied replies.
            temperature: wantsJsonOut ? 0.9 : 0.7,
            max_tokens: 1000
        };

        // Use Groq's native structured output for flashcard generation.
        if (wantsJsonOut) {
            body.response_format = { type: "json_object" };
        }

        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
        });

        console.log("Groq API response status:", response.status);

        if (!response.ok) {
            const errorText = await response.text();
            console.error("Groq API Error:", response.status, errorText);
            return res.status(response.status).json({
                error: "AI service error",
                details: errorText,
                status: response.status
            });
        }

        const data = await response.json();
        console.log("Successfully received response from Groq API");
        return res.status(200).json(data);

    } catch (error) {
        console.error("API Handler Error:", error);
        return res.status(500).json({
            error: "Failed to communicate with AI service",
            details: error.message
        });
    }
}

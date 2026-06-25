// /api/chat.js - Clean, Groq-Only Production Version
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: "Method not allowed" });
    }

    const { prompt, model: requestedModel } = req.body;

    if (!process.env.GROQ_API_KEY) {
        return res.status(500).json({ error: "GROQ_API_KEY is not configured on the server." });
    }

    // Automatically route requests to the best tool for the job
    const isFlashcardRequest = requestedModel === 'flashcard' ||
        (prompt && (prompt.toLowerCase().includes('flashcard') || prompt.toLowerCase().includes('json')));

    // Select the optimal specialized model
    const selectedModel = isFlashcardRequest ? "openai/gpt-oss-120b" : "openai/gpt-oss-20b";

    // Tailor system behavior for structured study tools vs conversational training
    const SYSTEM_INSTRUCTION = isFlashcardRequest
        ? "You are an expert academic assistant. Generate highly accurate, clear, and well-structured study flashcards containing key terms and definitions based on the provided text."
        : "You are an encouraging, responsive, and highly capable AI assistant helping students with their overall study preparation and research project defense training.";

    try {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: selectedModel,
                messages: [
                    { role: "system", content: SYSTEM_INSTRUCTION },
                    { role: "user", content: prompt }
                ],
                // Lower temperature ensures rigid structure for flashcards; higher gives the chatbot natural flexibility
                temperature: isFlashcardRequest ? 0.1 : 0.6,
                max_tokens: isFlashcardRequest ? 2000 : 1000
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            return res.status(response.status).json({ error: `Groq API Error: ${errorText}` });
        }

        const data = await response.json();
        const rawContent = data.choices[0].message.content;

        return res.status(200).json({
            content: rawContent,
            modelUsed: selectedModel
        });

    } catch (error) {
        console.error("Server Error:", error);
        return res.status(500).json({ error: "An internal server error occurred while processing your request." });
    }
}
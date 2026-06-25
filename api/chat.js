// /api/chat.js - Simplified Groq-only version
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: "Method not allowed" });
    }

    const { prompt, type } = req.body; // type: 'flashcard' or 'chat'

    try {
        // Choose the best model for each task
        const model = type === 'flashcard'
            ? "llama-3.1-70b-versatile"  // Best for structured content
            : "llama-3.1-8b-instant";    // Fast for chat

        if (!process.env.GROQ_API_KEY) {
            throw new Error("GROQ_API_KEY not configured");
        }

        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: model,
                messages: [{ role: "user", content: prompt }],
                temperature: type === 'flashcard' ? 0.1 : 0.7,
                max_tokens: 1000
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Groq API Error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        const content = data.choices[0].message.content;

        // For flashcards, ensure JSON format
        if (type === 'flashcard') {
            try {
                // Try to parse as JSON first
                const jsonContent = JSON.parse(content);
                return res.status(200).json(jsonContent);
            } catch {
                // If not JSON, extract from markdown code blocks
                let cleanContent = content.trim();
                if (cleanContent.startsWith("```json")) {
                    cleanContent = cleanContent.substring(7);
                }
                if (cleanContent.endsWith("```")) {
                    cleanContent = cleanContent.substring(0, cleanContent.length - 3);
                }
                const jsonContent = JSON.parse(cleanContent.trim());
                return res.status(200).json(jsonContent);
            }
        } else {
            // For chat, return plain text
            return res.status(200).json({ content });
        }

    } catch (error) {
        console.error("API Handler Error:", error);
        return res.status(500).json({
            error: "Failed to communicate with AI service",
            details: error.message
        });
    }
}

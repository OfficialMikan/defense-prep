// defense-prep/api/chat.js

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: "Method not allowed" });
    }

    const { prompt, model } = req.body;

    // Validate API key exists
    if (!process.env.GROQ_API_KEY) {
        return res.status(500).json({ error: "API key not configured" });
    }

    // Use specified model or default to llama-3.3-70b-versatile
    const selectedModel = model || "llama-3.3-70b-versatile";

    try {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: selectedModel,
                messages: [{ role: "user", content: prompt }],
                temperature: 0.1,
                response_format: { type: "json_object" }
            })
        });

        // Check if response is ok
        if (!response.ok) {
            const errorText = await response.text();
            console.error("Groq API Error:", response.status, errorText);
            return res.status(response.status).json({
                error: "AI service error",
                details: errorText
            });
        }

        const data = await response.json();
        return res.status(200).json(data);

    } catch (error) {
        console.error("API Handler Error:", error);
        return res.status(500).json({
            error: "Failed to communicate with AI service",
            details: error.message
        });
    }
}

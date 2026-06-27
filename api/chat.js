// /api/chat.js
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: "Method not allowed" });
    }

    const { prompt } = req.body;

    try {
        // Validate API key exists
        if (!process.env.GROQ_API_KEY) {
            console.error("GROQ_API_KEY not found in environment variables");
            return res.status(500).json({
                error: "Server configuration error",
                details: "API key not configured"
            });
        }

        console.log("Making request to Groq API");

        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "llama-3.3-70b-versatile",
                messages: [{ role: "user", content: prompt }],
                temperature: 0.1,
                max_tokens: 1000
            })
        });

        console.log("Groq API response status:", response.status);

        // Check if response is ok
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

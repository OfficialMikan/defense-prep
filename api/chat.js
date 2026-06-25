// defense-prep/api/chat.js

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: "Method not allowed" });
    }

    const { prompt, provider } = req.body;

    try {
        let response;

        switch (provider) {
            case 'groq':
                response = await callGroqAPI(prompt, req.body.model);
                break;
            case 'openai':
                response = await callOpenAIAPI(prompt);
                break;
            case 'gemini':
                response = await callGeminiAPI(prompt);
                break;
            default:
                // Try providers in order of preference
                try {
                    response = await callGroqAPI(prompt, req.body.model);
                } catch (groqError) {
                    try {
                        response = await callOpenAIAPI(prompt);
                    } catch (openaiError) {
                        response = await callGeminiAPI(prompt);
                    }
                }
        }

        return res.status(200).json(response);

    } catch (error) {
        console.error("API Handler Error:", error);
        return res.status(500).json({
            error: "Failed to communicate with AI service",
            details: error.message
        });
    }
}

async function callGroqAPI(prompt, model = "llama-3.3-70b-versatile") {
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
            temperature: 0.1,
            response_format: { type: "json_object" }
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Groq API Error: ${response.status} - ${errorText}`);
    }

    return await response.json();
}

async function callOpenAIAPI(prompt) {
    if (!process.env.OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY not configured");
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: "gpt-3.5-turbo",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.1,
            response_format: { type: "json_object" }
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API Error: ${response.status} - ${errorText}`);
    }

    return await response.json();
}

async function callGeminiAPI(prompt) {
    if (!process.env.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY not configured");
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${process.env.GEMINI_API_KEY}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            contents: [{
                parts: [{ text: prompt }]
            }],
            generationConfig: {
                temperature: 0.1,
                response_mime_type: "application/json"
            }
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API Error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    // Convert Gemini response to match OpenAI format
    return {
        choices: [{
            message: {
                content: data.candidates[0].content.parts[0].text
            }
        }]
    };
}

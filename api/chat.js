// /api/chat.js - Production Ready, Auto-Fallback Streamliner
const SYSTEM_INSTRUCTION = "You are an expert academic panelist conducting a rigorous mock title defense. Ask critical, analytical questions about methodology, scope, and significance, and provide structured feedback to help the student polish their presentation.";

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: "Method not allowed" });
    }

    const { prompt, provider, model } = req.body;
    const errors = {};

    // Standard waterfall sequence order
    const providersSequence = ['groq', 'gemini', 'mistral', 'anthropic', 'openai'];

    // If the frontend explicitly requested a specific provider, prioritize it first
    let executionOrder = [...providersSequence];
    if (provider && executionOrder.includes(provider)) {
        executionOrder = [provider, ...executionOrder.filter(p => p !== provider)];
    }

    // Sequentially step through providers until one succeeds
    for (const currentProvider of executionOrder) {
        try {
            let rawContent;
            switch (currentProvider) {
                case 'groq':
                    rawContent = await callGroqAPI(prompt, model);
                    break;
                case 'gemini':
                    rawContent = await callGeminiAPI(prompt);
                    break;
                case 'mistral':
                    rawContent = await callMistralAPI(prompt);
                    break;
                case 'anthropic':
                    rawContent = await callAnthropicAPI(prompt);
                    break;
                case 'openai':
                    rawContent = await callOpenAIAPI(prompt);
                    break;
            }

            // Success! Return the data immediately to the frontend
            return res.status(200).json({ content: rawContent, provider: currentProvider });
        } catch (err) {
            // Log individual failures internally and proceed to the next fallback
            errors[currentProvider] = err.message;
            console.warn(`[Fallback Warning] ${currentProvider} failed: ${err.message}`);
        }
    }

    // If the code executes down to here, it means every single provider completely failed
    return res.status(500).json({
        error: "All configured AI providers failed. Check system logs.",
        details: errors
    });
}

async function callGroqAPI(prompt, model) {
    if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY not configured");
    const chosenModel = model || "llama-3.3-70b-versatile";

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: chosenModel === "llama-3.1-70b-versatile" ? "llama-3.3-70b-versatile" : chosenModel,
            messages: [
                { role: "system", content: SYSTEM_INSTRUCTION },
                { role: "user", content: prompt }
            ],
            temperature: 0.5
        })
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Groq API Error: ${response.status} - ${errText}`);
    }
    const data = await response.json();
    return data.choices[0].message.content;
}

async function callGeminiAPI(prompt) {
    if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured");

    // Fixed: Upgraded to gemini-3.5-flash to eliminate 404 endpoint errors
    const response = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-3.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
            generationConfig: { temperature: 0.6, maxOutputTokens: 1200 }
        })
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Gemini API Error: ${response.status} - ${errText}`);
    }
    const data = await response.json();
    if (data.candidates && data.candidates[0]?.content?.parts[0]?.text) {
        return data.candidates[0].content.parts[0].text;
    }
    throw new Error("Invalid response schema from Gemini API");
}

async function callOpenAIAPI(prompt) {
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: SYSTEM_INSTRUCTION },
                { role: "user", content: prompt }
            ],
            temperature: 0.5
        })
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenAI API Error: ${response.status} - ${errText}`);
    }
    const data = await response.json();
    return data.choices[0].message.content;
}

async function callAnthropicAPI(prompt) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");
    const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
            "x-api-key": process.env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: "claude-3-haiku-20240307",
            max_tokens: 1000,
            temperature: 0.2,
            messages: [{ role: "user", content: `${SYSTEM_INSTRUCTION}\n\n${prompt}` }]
        })
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Anthropic API Error: ${response.status} - ${errText}`);
    }
    const data = await response.json();
    return data.content[0].text;
}

async function callMistralAPI(prompt) {
    if (!process.env.MISTRAL_API_KEY) throw new Error("MISTRAL_API_KEY not configured");
    const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${process.env.MISTRAL_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: "mistral-small-latest",
            messages: [
                { role: "system", content: SYSTEM_INSTRUCTION },
                { role: "user", content: prompt }
            ],
            temperature: 0.2,
            max_tokens: 1000
        })
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Mistral API Error: ${response.status} - ${errText}`);
    }
    const data = await response.json();
    return data.choices[0].message.content;
}
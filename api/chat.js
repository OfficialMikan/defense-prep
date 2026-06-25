// /api/chat.js - Production Fixed Version
const SYSTEM_INSTRUCTION = `You are an expert academic panelist and research mentor helping students prepare for their Research Title Defense. 
Your goal is to challenge their study, test their knowledge on research methodologies, help refine their problem statements, and build their presentation confidence. 
Keep your responses sharp, constructive, structured, and highly practical.`;

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: "Method not allowed" });
    }

    const { prompt, provider, model } = req.body;

    if (!prompt) {
        return res.status(400).json({ error: "Prompt is required" });
    }

    let rawContent;
    let errors = [];

    // Collection of API service callers
    const callers = {
        groq: () => callGroqAPI(prompt, model),
        openai: () => callOpenAIAPI(prompt),
        gemini: () => callGeminiAPI(prompt),
        anthropic: () => callAnthropicAPI(prompt),
        mistral: () => callMistralAPI(prompt)
    };

    // 1. Try requested provider first if specified
    if (provider && callers[provider]) {
        try {
            rawContent = await callers[provider]();
            return res.status(200).json({ content: rawContent });
        } catch (err) {
            console.error(`Primary provider (${provider}) failed:`, err.message);
            errors.push(`${provider}: ${err.message}`);
        }
    }

    // 2. Fallback Cascade Sequence (Executes sequentially if primary choice fails)
    const fallbackOrder = ['groq', 'gemini', 'mistral', 'anthropic', 'openai'];

    for (const currentProvider of fallbackOrder) {
        // Skip if we already attempted this provider above and it failed
        if (provider === currentProvider) continue;

        try {
            console.log(`Attempting fallback provider: ${currentProvider}`);
            rawContent = await callers[currentProvider]();
            if (rawContent) {
                return res.status(200).json({
                    content: rawContent,
                    fallbackUsed: true,
                    providerUsed: currentProvider
                });
            }
        } catch (err) {
            console.error(`Fallback provider (${currentProvider}) failed:`, err.message);
            errors.push(`${currentProvider}: ${err.message}`);
        }
    }

    // 3. If everything fails, return detailed diagnostic log
    return res.status(500).json({
        error: "All configured AI providers failed. Check system logs.",
        details: errors
    });
}

// --- API Service Callers ---

async function callGroqAPI(prompt, model) {
    if (!process.env.GROQ_API_KEY) {
        throw new Error("GROQ_API_KEY not configured");
    }

    // FIX: Automatically swap decommissioned llama-3.1-70b-versatile with llama-3.3-70b-versatile
    const activeModel = (model === 'llama-3.1-70b-versatile' || !model)
        ? 'llama-3.3-70b-versatile'
        : model;

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: activeModel,
            messages: [
                { role: "system", content: SYSTEM_INSTRUCTION },
                { role: "user", content: prompt }
            ],
            temperature: 0.3
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Groq API Error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
}

async function callGeminiAPI(prompt) {
    if (!process.env.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY not configured");
    }

    // FIX: Using the fully supported production v1 stable endpoint path
    const targetUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const response = await fetch(targetUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            contents: [
                {
                    parts: [
                        { text: `${SYSTEM_INSTRUCTION}\n\nUser Prompt:\n${prompt}` }
                    ]
                }
            ],
            generationConfig: {
                temperature: 0.3,
                maxOutputTokens: 1200
            }
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API Error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
        return data.candidates[0].content.parts[0].text;
    }
    throw new Error("Gemini API parsed successfully but returned empty context contents.");
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
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: SYSTEM_INSTRUCTION },
                { role: "user", content: prompt }
            ],
            temperature: 0.3
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API Error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
}

async function callAnthropicAPI(prompt) {
    if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error("ANTHROPIC_API_KEY not configured");
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
            "x-api-key": process.env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: "claude-3-haiku-20240307",
            max_tokens: 1200,
            temperature: 0.2,
            messages: [
                { role: "user", content: `${SYSTEM_INSTRUCTION}\n\n${prompt}` }
            ]
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Anthropic API Error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data.content[0].text;
}

async function callMistralAPI(prompt) {
    if (!process.env.MISTRAL_API_KEY) {
        throw new Error("MISTRAL_API_KEY not configured");
    }

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
            temperature: 0.3
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Mistral API Error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
}
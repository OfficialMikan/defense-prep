// /api/chat.js - Fixed version
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: "Method not allowed" });
    }

    const { prompt, provider, model } = req.body;

    try {
        let rawContent;

        switch (provider) {
            case 'groq':
                rawContent = await callGroqAPI(prompt, model);
                break;
            case 'openai':
                rawContent = await callOpenAIAPI(prompt);
                break;
            case 'gemini':
                rawContent = await callGeminiAPI(prompt);
                break;
            case 'anthropic':
                rawContent = await callAnthropicAPI(prompt);
                break;
            case 'mistral':
                rawContent = await callMistralAPI(prompt);
                break;
            default:
                // Fallback sequence with error handling
                try {
                    rawContent = await callGroqAPI(prompt, model);
                } catch (groqError) {
                    try {
                        rawContent = await callMistralAPI(prompt);
                    } catch (mistralError) {
                        try {
                            rawContent = await callAnthropicAPI(prompt);
                        } catch (anthropicError) {
                            try {
                                rawContent = await callGeminiAPI(prompt);
                            } catch (geminiError) {
                                // Last resort - try OpenAI even if quota issues
                                rawContent = await callOpenAIAPI(prompt);
                            }
                        }
                    }
                }
        }

        // Clean out any formatting wrappers
        let cleanText = rawContent.trim();
        if (cleanText.startsWith("```json")) {
            cleanText = cleanText.substring(7);
        }
        if (cleanText.endsWith("```")) {
            cleanText = cleanText.substring(0, cleanText.length - 3);
        }

        // Parse into a validated clean JSON object
        const jsonResponse = JSON.parse(cleanText.trim());
        return res.status(200).json(jsonResponse);

    } catch (error) {
        console.error("API Handler Error:", error);
        return res.status(500).json({
            error: "Failed to communicate with AI service",
            details: error.message
        });
    }
}

// System instruction for consistent responses
const SYSTEM_INSTRUCTION = `You are a strict, highly critical Senior High School research panel defense judge. 
Your sole source of absolute truth is the research proposal provided.
CRITICAL RULES:
1. TRUST THE DATA: Extract information directly from the proposal
2. NO GUESSING: Only use information explicitly stated or clearly implied
3. NO LAZY REFUSALS: Never say "not detailed" if answerable from text
4. FRAME: Use third person plural ('The researchers...')
5. FORMAT: Return ONLY valid JSON {"question": "...", "answer": "..."}`;

async function callGroqAPI(prompt, model = "llama-3.1-70b-versatile") {
    if (!process.env.GROQ_API_KEY) {
        throw new Error("GROQ_API_KEY not configured");
    }

    // Fix for Groq JSON requirement - ensure prompt mentions "json"
    const jsonPrompt = prompt.includes("json") ? prompt : `json\n${prompt}`;

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: model,
            messages: [
                { role: "system", content: SYSTEM_INSTRUCTION },
                { role: "user", content: jsonPrompt } // Fixed prompt
            ],
            temperature: 0.1,
            response_format: { type: "json_object" },
            max_tokens: 1000
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Groq API Error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
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
            model: "gpt-3.5-turbo", // Use cheaper model to avoid quota issues
            messages: [
                { role: "system", content: SYSTEM_INSTRUCTION },
                { role: "user", content: prompt }
            ],
            temperature: 0.1,
            max_tokens: 1000
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API Error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
}

async function callGeminiAPI(prompt) {
    if (!process.env.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY not configured");
    }

    // FIXED: Use correct model name
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            contents: [{
                parts: [{ text: prompt }]
            }],
            systemInstruction: {
                parts: [{ text: SYSTEM_INSTRUCTION }]
            },
            generationConfig: {
                temperature: 0.1,
                responseMimeType: "application/json",
                maxOutputTokens: 1000
            }
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API Error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    // Handle Gemini response format
    if (data.candidates && data.candidates[0] && data.candidates[0].content) {
        return data.candidates[0].content.parts[0].text;
    }

    throw new Error("Unexpected Gemini response format");
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
            "content-type": "application/json"
        },
        body: JSON.stringify({
            model: "claude-3-haiku-20240307",
            max_tokens: 1000,
            temperature: 0.1,
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
            temperature: 0.1,
            max_tokens: 1000
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Mistral API Error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
}

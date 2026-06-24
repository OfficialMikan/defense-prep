export default async function handler(req, res) {
    // This reads the secret variable from Vercel's dashboard
    const { prompt } = req.body;

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.75,
            response_format: { type: "json_object" }
        })
    });

    const data = await response.json();
    res.status(200).json(data);
}
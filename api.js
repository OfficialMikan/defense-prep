// api.js
export default async function handler(req, res) {
    const { prompt } = req.body;

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
            // This reads the variable you set in the Vercel Dashboard
            "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: prompt }]
        })
    });

    const data = await response.json();
    res.status(200).json(data);
}
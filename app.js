import express from "express";

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Gemini Proxy ONLINE");
});

app.post("/v1/chat/completions", async (req, res) => {
  try {
    const message =
      req.body?.messages?.map(m => m.content).join("\n") || "";

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${process.env.GOOGLE_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: message }] }]
        })
      }
    );

    const data = await r.json();
    const text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text || "Sem resposta";

    res.json({
      id: "chatcmpl-gemini",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "gpt-3.5-turbo",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: text },
          finish_reason: "stop"
        }
      ]
    });
  } catch {
    res.status(500).json({ error: "Erro Gemini" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log("Gemini Proxy rodando na porta", port);
});

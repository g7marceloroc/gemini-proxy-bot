import express from "express";

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Gemini Proxy Online");
});

app.post("/v1/chat/completions", async (req, res) => {
  const userMessage =
    req.body?.messages?.map(m => m.content).join("\n") || "Olá";

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${process.env.GOOGLE_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: userMessage }] }]
      })
    }
  );

  const data = await response.json();
  const text =
    data?.candidates?.[0]?.content?.parts?.[0]?.text || "Sem resposta";

  res.json({
    id: "chatcmpl-gemini",
    object: "chat.completion",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: "stop"
      }
    ]
  });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("Servidor rodando na porta", PORT));

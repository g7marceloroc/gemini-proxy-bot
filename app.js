import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;

/* 🔹 ENDPOINT OBRIGATÓRIO PARA BOT NINJA */
app.get("/v1/models", (req, res) => {
  res.json({
    object: "list",
    data: [
      {
        id: "gpt-3.5-turbo",
        object: "model",
        created: 0,
        owned_by: "openai"
      }
    ]
  });
});

/* 🔹 CHAT COMPLETIONS */
app.post("/v1/chat/completions", async (req, res) => {
  try {
    const messages = req.body.messages || [];
    const userText = messages.map(m => m.content).join("\n");

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GOOGLE_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: userText }] }]
        })
      }
    );

    const data = await response.json();
    const text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "Sem resposta do Gemini";

    res.json({
      id: "chatcmpl-gemini",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "gpt-3.5-turbo",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: text
          },
          finish_reason: "stop"
        }
      ]
    });
  } catch (err) {
    res.status(500).json({ error: "Erro no Gemini Proxy" });
  }
});

app.listen(PORT, () => {
  console.log("Gemini Proxy rodando na porta", PORT);
});

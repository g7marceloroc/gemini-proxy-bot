const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// rota raiz (teste de vida)
app.get("/", (req, res) => {
  res.send("Gemini Proxy OK");
});

// rota compatível com OpenAI
app.post("/v1/chat/completions", async (req, res) => {
  try {
    const messages = req.body.messages || [];
    const lastMessage = messages[messages.length - 1]?.content || "";

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${process.env.GOOGLE_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: lastMessage }]
            }
          ]
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
    res.status(500).json({ error: "Erro no proxy Gemini" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

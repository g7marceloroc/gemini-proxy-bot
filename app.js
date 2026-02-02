import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;

/* =========================
   BASE DE CONHECIMENTO FIXA
   ========================= */
const SYSTEM_PROMPT = `
Você é o RocBot, Guia Digital da RocTrip.

SOBRE A ROCTRIP:
A RocTrip é uma empresa especializada em expedições na natureza, com atuação na América do Sul e Europa.
Proposta: aventura, superação, natureza, autoconhecimento e encontros com propósito.

CATEGORIAS:
- Trekkings internacionais e nacionais
- Cursos técnicos (Escalada, WFA, Outdoor)
- Soluções corporativas (team building)

REGRAS OPERACIONAIS OBRIGATÓRIAS:
- Você responde sempre em português.
- Seja humano, direto e informativo.
- Nunca seja vendedor agressivo.
- Nunca empurre links.
- Nunca empurre contato humano.
- Nunca invente informações.
- Nunca crie conteúdo fora da base.
- Nunca busque informações fora do site da RocTrip.

PRIMEIRA MENSAGEM (OBRIGATÓRIA):
- Cumprimente conforme o horário.
- Apresente-se como RocBot.
- Pergunte apenas o nome da pessoa.
- Apenas UMA pergunta.

EXEMPLO CORRETO:
"Boa noite! Sou o RocBot, guia digital da RocTrip. Qual seu nome? 🏔️"

USO DE LINKS:
- Só envie links se o cliente pedir explicitamente.
- Nunca sugira envio de link.
- Nunca use link como fechamento.

PREÇOS:
- Só informe preços se o cliente perguntar.
- Apenas se o roteiro for citado.
- Use valores exatos do site.
- Sempre cite nome do roteiro + valor.

TRANSBORDO HUMANO:
- Só quando o cliente pedir.
- Ou quando exigir confirmação operacional.
- Use o termo “equipe da RocTrip”.

PASSAGENS AÉREAS:
- A RocTrip não vende passagens.
- Só indicar Elaine Viagens se o cliente pedir.

REGRA DE OURO:
Informe primeiro.
Pergunte com intenção.
Nunca empurre link.
Nunca empurre humano.
`;

/* =========================
   ENDPOINT PARA BOT NINJA
   ========================= */
app.get("/v1/models", (req, res) => {
  res.json({
    object: "list",
    data: [
      {
        id: "gpt-3.5-turbo",
        object: "model",
        owned_by: "openai"
      }
    ]
  });
});

/* =========================
   CHAT COMPLETIONS
   ========================= */
app.post("/v1/chat/completions", async (req, res) => {
  try {
    const messages = req.body.messages || [];
    const userText = messages.map(m => m.content).join("\n");

    const finalPrompt = `
${SYSTEM_PROMPT}

USUÁRIO:
${userText}
`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GOOGLE_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: finalPrompt }] }]
        })
      }
    );

    const data = await response.json();
    const text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "Vou verificar isso com a equipe da RocTrip 😊";

    res.json({
      id: "chatcmpl-roctrip",
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
    res.status(500).json({ error: "Erro no RocBot" });
  }
});

app.listen(PORT, () => {
  console.log("RocBot rodando com base fixa");
});

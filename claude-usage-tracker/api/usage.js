import { loadState, hasRedis } from "./_lib/store.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Use GET" });
  }

  // Proteção de leitura opcional: defina READ_TOKEN na Vercel para exigir token.
  const readToken = process.env.READ_TOKEN;
  if (readToken) {
    const auth = req.headers.authorization || "";
    const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const query = req.query?.token || "";
    if (bearer !== readToken && query !== readToken) {
      return res.status(401).json({ error: "Token de leitura inválido" });
    }
  }

  try {
    const { latest, history } = await loadState();
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      latest,
      history,
      persistent: hasRedis,
      serverTime: Date.now(),
    });
  } catch (err) {
    console.error("Falha ao ler snapshot:", err);
    return res.status(502).json({ error: "Falha ao ler o armazenamento" });
  }
}

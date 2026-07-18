import { saveSnapshot } from "./_lib/store.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST" });
  }

  const expected = process.env.INGEST_TOKEN;
  if (!expected) {
    return res.status(500).json({
      error: "INGEST_TOKEN não configurado no projeto da Vercel",
    });
  }

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token !== expected) {
    return res.status(401).json({ error: "Token inválido" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: "JSON inválido" });
    }
  }
  if (!body || typeof body !== "object") {
    return res.status(400).json({ error: "Corpo vazio" });
  }

  const snapshot = { ...body, receivedAt: Date.now() };

  try {
    await saveSnapshot(snapshot);
  } catch (err) {
    console.error("Falha ao salvar snapshot:", err);
    return res.status(502).json({ error: "Falha ao salvar no armazenamento" });
  }

  return res.status(200).json({ ok: true });
}

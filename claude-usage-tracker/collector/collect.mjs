#!/usr/bin/env node
// Coletor local de uso do Claude.
//
// Roda na máquina onde você usa o Claude Code / app Claude e, a cada intervalo:
//   1. Consulta o endpoint de uso da conta (o mesmo que alimenta a tela "Uso"
//      do app) usando o token OAuth salvo pelo Claude Code.
//   2. Soma os tokens dos logs locais do Claude Code (~/.claude/projects/*.jsonl)
//      nas janelas de 5 horas e 7 dias, com custo estimado por modelo.
//   3. Envia tudo para o dashboard na Vercel (POST /api/ingest).
//
// Uso:
//   TRACKER_URL=https://seu-app.vercel.app INGEST_TOKEN=xxx node collect.mjs
//
// Variáveis:
//   TRACKER_URL       (obrigatória) URL do deploy na Vercel
//   INGEST_TOKEN      (obrigatória) mesmo valor configurado na Vercel
//   INTERVAL_SECONDS  intervalo entre coletas (padrão 60; 0 = uma coleta só)
//   CLAUDE_DIR        pasta do Claude Code (padrão ~/.claude)

import { readFile, readdir, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { createReadStream } from "node:fs";
import { homedir, hostname } from "node:os";
import path from "node:path";

const TRACKER_URL = (process.env.TRACKER_URL || "").replace(/\/+$/, "");
const INGEST_TOKEN = process.env.INGEST_TOKEN || "";
const INTERVAL_SECONDS = Number(process.env.INTERVAL_SECONDS ?? 60);
const CLAUDE_DIR = process.env.CLAUDE_DIR || path.join(homedir(), ".claude");

const HOUR = 3600 * 1000;
const WINDOW_5H = 5 * HOUR;
const WINDOW_7D = 7 * 24 * HOUR;

// Preço por milhão de tokens (entrada/saída). Cache: leitura ≈ 0,1x entrada,
// escrita ≈ 1,25x entrada. Estimativa — ajuste se necessário.
const PRICES = [
  { match: /fable|mythos/i, input: 10, output: 50 },
  { match: /opus/i, input: 5, output: 25 },
  { match: /sonnet/i, input: 3, output: 15 },
  { match: /haiku/i, input: 1, output: 5 },
];

function priceFor(model) {
  return PRICES.find((p) => p.match.test(model || "")) || { input: 5, output: 25 };
}

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

// ---------------------------------------------------------------------------
// 1. Limites da conta (endpoint OAuth usado pelo app/Claude Code)
// ---------------------------------------------------------------------------

async function readOauthToken() {
  const credPath = path.join(CLAUDE_DIR, ".credentials.json");
  try {
    const raw = JSON.parse(await readFile(credPath, "utf8"));
    const oauth = raw.claudeAiOauth || raw.oauth || raw;
    return oauth?.accessToken || null;
  } catch {
    return null;
  }
}

async function fetchAccountLimits() {
  const token = await readOauthToken();
  if (!token) {
    log("aviso: não achei token OAuth em", CLAUDE_DIR, "(pulei limites da conta)");
    return null;
  }
  try {
    const res = await fetch("https://api.anthropic.com/api/oauth/usage", {
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) {
      log(`aviso: endpoint de uso respondeu ${res.status} (token expirado? abra o Claude Code para renovar)`);
      return null;
    }
    return normalizeLimits(await res.json());
  } catch (err) {
    log("aviso: falha ao consultar limites:", err.message);
    return null;
  }
}

// Normaliza a resposta sem depender do formato exato: coleta todo objeto que
// tenha um campo `utilization`, em qualquer nível.
function normalizeLimits(raw) {
  const buckets = [];
  (function walk(obj, keyPath) {
    if (!obj || typeof obj !== "object") return;
    if (typeof obj.utilization === "number") {
      buckets.push({
        key: keyPath,
        utilization: obj.utilization,
        resetsAt: obj.resets_at || obj.resetsAt || null,
      });
      return;
    }
    for (const [k, v] of Object.entries(obj)) {
      walk(v, keyPath ? `${keyPath}.${k}` : k);
    }
  })(raw, "");

  const find = (re) => buckets.find((b) => re.test(b.key)) || null;
  const session = find(/five|5.?h|session/i);
  const weekly = buckets.find((b) => /seven|7.?d|week/i.test(b.key) && !/opus|fable|sonnet|model/i.test(b.key)) || null;
  const weeklyModel = find(/opus|fable|sonnet|model/i);

  return { session, weekly, weeklyModel, buckets, raw };
}

// ---------------------------------------------------------------------------
// 2. Tokens dos logs locais do Claude Code
// ---------------------------------------------------------------------------

async function* jsonlFiles(dir, since) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* jsonlFiles(full, since);
    } else if (entry.name.endsWith(".jsonl")) {
      try {
        const info = await stat(full);
        if (info.mtimeMs >= since) yield full;
      } catch {
        /* ignora arquivos que sumiram no meio */
      }
    }
  }
}

function emptyBucket() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0, costUsd: 0 };
}

function addUsage(bucket, usage, model) {
  const price = priceFor(model);
  const input = usage.input_tokens || 0;
  const output = usage.output_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const cacheWrite = usage.cache_creation_input_tokens || 0;
  bucket.input += input;
  bucket.output += output;
  bucket.cacheRead += cacheRead;
  bucket.cacheWrite += cacheWrite;
  bucket.requests += 1;
  bucket.costUsd +=
    (input * price.input +
      output * price.output +
      cacheRead * price.input * 0.1 +
      cacheWrite * price.input * 1.25) /
    1e6;
}

async function collectLocalTokens() {
  const now = Date.now();
  const projectsDir = path.join(CLAUDE_DIR, "projects");
  const last5h = emptyBucket();
  const last7d = emptyBucket();
  const byModel7d = {};
  const seen = new Set(); // dedupe: streaming grava a mesma mensagem mais de uma vez

  // margem de 1 dia sobre a janela de 7d para pegar arquivos ainda ativos
  for await (const file of jsonlFiles(projectsDir, now - WINDOW_7D - 24 * HOUR)) {
    const rl = createInterface({
      input: createReadStream(file, "utf8"),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (!line.includes('"usage"')) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const usage = entry.message?.usage;
      if (!usage) continue;
      const ts = Date.parse(entry.timestamp || "");
      if (!ts || now - ts > WINDOW_7D) continue;

      const dedupeKey = `${entry.message.id || ""}:${entry.requestId || ""}`;
      if (dedupeKey !== ":" ) {
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
      }

      const model = entry.message.model || "desconhecido";
      addUsage(last7d, usage, model);
      byModel7d[model] ??= emptyBucket();
      addUsage(byModel7d[model], usage, model);
      if (now - ts <= WINDOW_5H) addUsage(last5h, usage, model);
    }
  }

  return { last5h, last7d, byModel7d };
}

// ---------------------------------------------------------------------------
// 3. Envio para o dashboard
// ---------------------------------------------------------------------------

async function sendSnapshot(snapshot) {
  const res = await fetch(`${TRACKER_URL}/api/ingest`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${INGEST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(snapshot),
  });
  if (!res.ok) {
    throw new Error(`ingest ${res.status}: ${await res.text()}`);
  }
}

async function tick() {
  const [limits, tokens] = await Promise.all([
    fetchAccountLimits(),
    collectLocalTokens().catch((err) => {
      log("aviso: falha ao ler logs locais:", err.message);
      return null;
    }),
  ]);

  const snapshot = {
    collectedAt: Date.now(),
    host: hostname(),
    limits,
    tokens,
  };

  await sendSnapshot(snapshot);
  const sess = limits?.session?.utilization;
  log(
    "snapshot enviado —",
    sess != null ? `sessão ${sess}%` : "sem limites",
    tokens ? `| 7d: ${((tokens.last7d.input + tokens.last7d.output) / 1000).toFixed(0)}k tokens` : ""
  );
}

async function main() {
  if (!TRACKER_URL || !INGEST_TOKEN) {
    console.error("Defina TRACKER_URL e INGEST_TOKEN. Ex.:");
    console.error("  TRACKER_URL=https://seu-app.vercel.app INGEST_TOKEN=xxx node collect.mjs");
    process.exit(1);
  }
  log(`coletor iniciado — enviando para ${TRACKER_URL} a cada ${INTERVAL_SECONDS}s`);
  for (;;) {
    try {
      await tick();
    } catch (err) {
      log("erro no ciclo:", err.message);
    }
    if (!INTERVAL_SECONDS) break;
    await new Promise((r) => setTimeout(r, INTERVAL_SECONDS * 1000));
  }
}

main();

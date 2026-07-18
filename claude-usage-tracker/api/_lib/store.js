// Armazenamento: Upstash Redis (REST) quando configurado, senão memória do processo.
// Vercel KV / Upstash Marketplace expõem KV_REST_API_URL / KV_REST_API_TOKEN;
// Upstash direto expõe UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN.
const REDIS_URL =
  process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const REDIS_TOKEN =
  process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";

export const hasRedis = Boolean(REDIS_URL && REDIS_TOKEN);

const KEY_LATEST = "claude-usage:latest";
const KEY_HISTORY = "claude-usage:history";
// 576 pontos ~= 48h de histórico com coleta a cada 5 min (ou ~9h a cada 1 min)
const HISTORY_MAX = 576;

// Fallback em memória: sobrevive apenas enquanto a função fica "quente".
const memory = (globalThis.__claudeUsageStore ??= { latest: null, history: [] });

async function redisPipeline(commands) {
  const res = await fetch(`${REDIS_URL}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
  });
  if (!res.ok) {
    throw new Error(`Redis pipeline ${res.status}: ${await res.text()}`);
  }
  return res.json(); // [{result}, ...]
}

export async function saveSnapshot(snapshot) {
  const point = historyPoint(snapshot);
  if (hasRedis) {
    const cmds = [["SET", KEY_LATEST, JSON.stringify(snapshot)]];
    if (point) {
      cmds.push(["LPUSH", KEY_HISTORY, JSON.stringify(point)]);
      cmds.push(["LTRIM", KEY_HISTORY, 0, HISTORY_MAX - 1]);
    }
    await redisPipeline(cmds);
    return;
  }
  memory.latest = snapshot;
  if (point) {
    memory.history.unshift(point);
    memory.history.length = Math.min(memory.history.length, HISTORY_MAX);
  }
}

export async function loadState() {
  if (hasRedis) {
    const [latestRes, historyRes] = await redisPipeline([
      ["GET", KEY_LATEST],
      ["LRANGE", KEY_HISTORY, 0, HISTORY_MAX - 1],
    ]);
    const latest = latestRes?.result ? JSON.parse(latestRes.result) : null;
    const history = (historyRes?.result || [])
      .map((item) => {
        try {
          return JSON.parse(item);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .reverse(); // cronológico (antigo -> novo)
    return { latest, history };
  }
  return { latest: memory.latest, history: [...memory.history].reverse() };
}

// Ponto compacto para o gráfico de histórico.
function historyPoint(snapshot) {
  const limits = snapshot?.limits;
  if (!limits) return null;
  return {
    t: snapshot.receivedAt || Date.now(),
    session: limits.session?.utilization ?? null,
    weekly: limits.weekly?.utilization ?? null,
    weeklyModel: limits.weeklyModel?.utilization ?? null,
  };
}

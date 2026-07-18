# Claude Usage Tracker

Dashboard em tempo (quase) real da sua utilização do Claude — os mesmos percentuais
da tela **"Uso"** do app (sessão atual, limites semanais), mais contagem de tokens
e custo estimado a partir dos logs locais do Claude Code.

## Como funciona

```
┌──────────────────────┐        POST /api/ingest         ┌─────────────────────┐
│  Sua máquina         │  ─────────────────────────────▶ │  Vercel (grátis)    │
│  collector/collect.mjs│                                 │  api/ingest.js      │
│  · endpoint de uso da │                                 │  api/usage.js       │
│    conta (OAuth do    │                                 │  index.html (painel)│
│    Claude Code)       │                                 │  Upstash Redis*     │
│  · ~/.claude/projects │                                 └─────────────────────┘
│    (*.jsonl → tokens) │                                        ▲
└──────────────────────┘                    navegador ──────────┘
```

Os limites de plano (percentuais de sessão/semana) **não têm API pública** — mas o
Claude Code guarda um token OAuth em `~/.claude/.credentials.json`, e o coletor usa
esse token para consultar o mesmo endpoint que alimenta a tela "Uso" do app. Como
esse token só existe na sua máquina, é preciso um coletor local: a Vercel apenas
recebe e exibe os dados.

## 1. Deploy na Vercel (grátis)

1. Em [vercel.com/new](https://vercel.com/new), importe este repositório.
2. Em **Root Directory**, selecione `claude-usage-tracker`. Framework: **Other**.
3. Em **Environment Variables**, adicione:
   - `INGEST_TOKEN` — um segredo qualquer (ex.: `openssl rand -hex 24`). É a senha
     que o coletor usa para enviar dados.
   - *(opcional)* `READ_TOKEN` — se definido, o dashboard pede esse token para
     exibir os dados (recomendado, já que a URL da Vercel é pública).
4. Deploy.

### Persistência (recomendado)

Sem banco, os dados ficam só na memória da função e podem sumir entre requisições.
Para persistir de graça:

1. No projeto da Vercel: **Storage → Create Database → Upstash Redis** (plano free).
2. Conecte ao projeto — as variáveis `KV_REST_API_URL` / `KV_REST_API_TOKEN` são
   criadas automaticamente (o código também aceita `UPSTASH_REDIS_REST_URL/TOKEN`).
3. Faça um redeploy.

Com Redis o dashboard também mostra o histórico da sessão (sparkline de ~48 h).

## 2. Rodar o coletor na sua máquina

Requisitos: Node 18+ e Claude Code já logado (é ele quem mantém o token OAuth).

```bash
TRACKER_URL=https://SEU-APP.vercel.app \
INGEST_TOKEN=o-mesmo-segredo-da-vercel \
node claude-usage-tracker/collector/collect.mjs
```

O coletor envia um snapshot a cada 60 s (ajuste com `INTERVAL_SECONDS`; use `0`
para uma coleta única, útil com cron). Se a pasta do Claude Code não for
`~/.claude`, defina `CLAUDE_DIR`.

### Deixar rodando sempre

- **macOS/Linux (pm2):** `pm2 start collector/collect.mjs --name claude-usage -- \
  ` com as variáveis no ambiente, ou use `cron` com `INTERVAL_SECONDS=0`.
- **Cron (a cada 5 min):**
  ```
  */5 * * * * TRACKER_URL=... INGEST_TOKEN=... INTERVAL_SECONDS=0 /usr/bin/env node /caminho/collector/collect.mjs
  ```
- **Windows:** Agendador de Tarefas chamando `node collect.mjs` com
  `INTERVAL_SECONDS=0`.

## 3. Abrir o dashboard

Acesse `https://SEU-APP.vercel.app`. O painel atualiza sozinho a cada 15 s e mostra:

- **Sessão atual** — % utilizado e quando reinicia (janela de 5 h);
- **Limites semanais** — todos os modelos e o limite específico de modelo
  (Fable/Opus), como no app;
- **Tokens** — entrada/saída/cache nas últimas 5 h e 7 dias, com custo estimado;
- **Por modelo** — ranking dos últimos 7 dias;
- **Histórico** — evolução do % da sessão (com Redis configurado).

## Observações e limitações

- O endpoint de uso da conta (`/api/oauth/usage`) é o mesmo que o app usa, mas
  **não é uma API pública documentada** — pode mudar sem aviso. O coletor foi
  escrito de forma defensiva: se o formato mudar ou a chamada falhar, ele continua
  enviando as métricas de tokens dos logs locais.
- Se o token OAuth expirar, basta abrir/usar o Claude Code que ele renova sozinho;
  o coletor volta a funcionar no ciclo seguinte.
- O **custo é estimado** com preços de tabela da API (Fable 10/50, Opus 5/25,
  Sonnet 3/15, Haiku 1/5 por MTok; cache leitura 0,1×, escrita 1,25×). Assinaturas
  Pro/Max não pagam por token — o valor serve como referência de "quanto isso
  custaria na API".
- Os tokens contados vêm dos logs do **Claude Code** desta máquina. Uso no app
  móvel/web não aparece na contagem de tokens (mas aparece nos percentuais
  oficiais, que vêm da conta).

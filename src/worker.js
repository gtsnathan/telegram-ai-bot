/**
 * Assistente de IA para Telegram — Cloudflare Worker
 *
 * Recursos:
 *  - Conversa com memória por chat (Cloudflare KV)
 *  - Dois provedores de IA: Workers AI (grátis) ou Claude (Anthropic)
 *  - Comandos: /start, /novo (limpa a conversa), /ajuda, /id
 *  - Lista de usuários permitidos (opcional)
 *  - Validação do webhook com secret token
 *  - Rota /setup para registrar o webhook automaticamente
 */

const TELEGRAM_LIMIT = 4000; // limite real é 4096; deixamos folga
const DEFAULT_SYSTEM_PROMPT =
  "Você é um assistente pessoal útil, direto e simpático. Responda sempre em português do Brasil, " +
  "de forma clara e objetiva. Use listas curtas quando ajudar. Se não souber algo, diga que não sabe.";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Registro do webhook: abra https://SEU-WORKER/setup?key=SEU_WEBHOOK_SECRET
    if (request.method === "GET" && url.pathname === "/setup") {
      if (url.searchParams.get("key") !== env.WEBHOOK_SECRET) {
        return new Response("Não autorizado", { status: 401 });
      }
      const res = await telegram(env, "setWebhook", {
        url: `${url.origin}/webhook`,
        secret_token: env.WEBHOOK_SECRET,
        allowed_updates: ["message"],
        drop_pending_updates: true,
      });
      await telegram(env, "setMyCommands", {
        commands: [
          { command: "novo", description: "Começar uma conversa nova" },
          { command: "ajuda", description: "Como usar o assistente" },
          { command: "id", description: "Mostrar seu ID do Telegram" },
        ],
      });
      return Response.json(res);
    }

    if (request.method === "POST" && url.pathname === "/webhook") {
      if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) {
        return new Response("Não autorizado", { status: 401 });
      }
      const update = await request.json();
      // Responde ao Telegram na hora e processa em segundo plano (evita reenvios)
      ctx.waitUntil(handleUpdate(update, env).catch((e) => console.error("Erro:", e)));
      return new Response("ok");
    }

    return new Response("Assistente de IA para Telegram está no ar ✅");
  },
};

async function handleUpdate(update, env) {
  const msg = update.message;
  if (!msg || !msg.text) return;

  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  const text = msg.text.trim();

  // Comando /id funciona para qualquer um (útil para montar a lista de permitidos)
  if (text.startsWith("/id")) {
    return send(env, chatId, `Seu ID do Telegram: ${userId}`);
  }

  if (!isAllowed(env, userId)) {
    return send(env, chatId, "⛔ Você não tem permissão para usar este assistente.");
  }

  if (text.startsWith("/start")) {
    return send(
      env,
      chatId,
      `Olá, ${msg.from?.first_name || "tudo bem"}! 👋\nSou seu assistente de IA. É só mandar uma mensagem.\n\n/novo — começa uma conversa do zero\n/ajuda — dicas de uso`
    );
  }
  if (text.startsWith("/ajuda")) {
    return send(
      env,
      chatId,
      "Mande qualquer pergunta ou pedido: textos, ideias, cálculos, resumos, código...\n\nEu lembro das últimas mensagens da conversa. Use /novo quando quiser mudar de assunto."
    );
  }
  if (text.startsWith("/novo") || text.startsWith("/reset")) {
    await env.HISTORY.delete(historyKey(chatId));
    return send(env, chatId, "🧹 Conversa limpa. Pode começar um assunto novo!");
  }

  // Mostra "digitando..." enquanto a IA pensa
  await telegram(env, "sendChatAction", { chat_id: chatId, action: "typing" });

  const history = await loadHistory(env, chatId);
  history.push({ role: "user", content: text });

  let reply;
  try {
    reply = await askAI(env, history);
  } catch (e) {
    console.error(e);
    return send(env, chatId, "⚠️ Não consegui responder agora. Tente de novo em instantes.");
  }

  history.push({ role: "assistant", content: reply });
  await saveHistory(env, chatId, history);
  await send(env, chatId, reply);
}

/* ---------------------------- IA ---------------------------- */

async function askAI(env, messages) {
  const system = env.SYSTEM_PROMPT || DEFAULT_SYSTEM_PROMPT;
  const provider = (env.AI_PROVIDER || "workers-ai").toLowerCase();

  if (provider === "anthropic") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: env.ANTHROPIC_MODEL || "claude-haiku-5-5",
        max_tokens: 1500,
        system,
        messages,
      }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  }

  // Padrão: Workers AI (plano gratuito da Cloudflare)
  const result = await env.AI.run(env.WORKERS_AI_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
    messages: [{ role: "system", content: system }, ...messages],
    max_tokens: 1500,
  });
  return (result.response || "").trim() || "Não consegui gerar uma resposta.";
}

/* ------------------------ Histórico (KV) ------------------------ */

const historyKey = (chatId) => `chat:${chatId}`;

async function loadHistory(env, chatId) {
  const saved = await env.HISTORY.get(historyKey(chatId), "json");
  return Array.isArray(saved) ? saved : [];
}

async function saveHistory(env, chatId, history) {
  const max = parseInt(env.MAX_HISTORY || "20", 10);
  let trimmed = history.slice(-max);
  // A conversa precisa começar com mensagem do usuário
  while (trimmed.length && trimmed[0].role !== "user") trimmed.shift();
  // Expira após 7 dias sem uso
  await env.HISTORY.put(historyKey(chatId), JSON.stringify(trimmed), { expirationTtl: 60 * 60 * 24 * 7 });
}

/* --------------------------- Telegram --------------------------- */

function isAllowed(env, userId) {
  const list = (env.ALLOWED_USERS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.length === 0 || list.includes(String(userId));
}

async function telegram(env, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function send(env, chatId, text) {
  for (const part of splitMessage(text)) {
    // Tenta com Markdown; se o Telegram recusar a formatação, envia texto puro
    const r = await telegram(env, "sendMessage", { chat_id: chatId, text: part, parse_mode: "Markdown" });
    if (!r.ok) await telegram(env, "sendMessage", { chat_id: chatId, text: part });
  }
}

function splitMessage(text) {
  const parts = [];
  let rest = text;
  while (rest.length > TELEGRAM_LIMIT) {
    let cut = rest.lastIndexOf("\n", TELEGRAM_LIMIT);
    if (cut < TELEGRAM_LIMIT / 2) cut = rest.lastIndexOf(" ", TELEGRAM_LIMIT);
    if (cut <= 0) cut = TELEGRAM_LIMIT;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}

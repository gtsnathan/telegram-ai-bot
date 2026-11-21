# Assistente de IA para Telegram

Bot de Telegram com IA rodando em Cloudflare Workers. Lembra o contexto da conversa, funciona de graça com Workers AI ou com o Claude (Anthropic).

## 1. Criar o bot no Telegram
1. Abra o **@BotFather** no Telegram e envie `/newbot`.
2. Escolha nome e usuário (precisa terminar em `bot`).
3. Copie o **token** que ele te passar.

## 2. Preparar o projeto
```bash
npm install -g wrangler        # se ainda não tiver
wrangler login
npx wrangler kv namespace create HISTORY
```
Cole o `id` retornado em `wrangler.toml` no lugar de `COLE_AQUI_O_ID_DO_KV`.

## 3. Cadastrar os segredos
```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN   # token do BotFather
npx wrangler secret put WEBHOOK_SECRET       # invente uma senha: só letras, números, _ e -
# Só se for usar o Claude:
npx wrangler secret put ANTHROPIC_API_KEY
```

## 4. Publicar
```bash
npx wrangler deploy
```
Depois abra no navegador (troque pelos seus dados):
```
https://telegram-ai-bot.SEU-USUARIO.workers.dev/setup?key=SEU_WEBHOOK_SECRET
```
Se aparecer `"ok": true`, está pronto. Mande uma mensagem para o bot.

## 5. Deixar só para você (recomendado)
1. Mande `/id` para o bot e copie o número.
2. Em `wrangler.toml`, coloque em `ALLOWED_USERS = "123456789"` (vários separados por vírgula).
3. `npx wrangler deploy` de novo.

## Trocar a IA
- **Workers AI (padrão, grátis):** `AI_PROVIDER = "workers-ai"`. O plano gratuito tem um limite diário de uso.
- **Claude:** `AI_PROVIDER = "anthropic"` + segredo `ANTHROPIC_API_KEY` (chave em console.anthropic.com). `claude-haiku-5-5` é o mais barato; `claude-sonnet-5-5` responde melhor.

## Personalidade
Descomente `SYSTEM_PROMPT` no `wrangler.toml` e escreva como o assistente deve se comportar. Ex.: *"Você é um especialista em vendas na Shopee e Mercado Livre..."*

## Comandos
| Comando | O que faz |
|---|---|
| `/start` | Boas-vindas |
| `/novo` | Apaga o histórico e começa do zero |
| `/ajuda` | Dicas de uso |
| `/id` | Mostra seu ID do Telegram |

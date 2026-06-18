# web-to-api

Turn free web AI chat sessions into a **local OpenAI-compatible API**.

Use DeepSeek, Kimi, and Qwen through their browser interfaces — no official API keys required. Any tool that speaks the OpenAI Chat Completions API (Cursor, Open WebUI, custom scripts) can connect to `http://127.0.0.1:3456/v1`.

## How it works

```text
Your client (OpenAI SDK, Cursor, curl, …)
  → http://127.0.0.1:3456/v1
  → web-to-api
  → Playwright Chromium (saved login session)
  → chat.deepseek.com / kimi.com / chat.qwen.ai
```

The server reuses your browser cookies and session state. It does not store vendor API keys.

## Features

- **OpenAI-compatible API** — `GET /v1/models`, `POST /v1/chat/completions` (stream + non-stream)
- **Three providers** — DeepSeek (4 models), Kimi, Qwen
- **`auto` model** — tries models in order until one succeeds
- **Pseudo tool calls** — prompt-based tool calling for clients that expect OpenAI `tool_calls`
- **Structured output** — `response_format` via prompt + JSON parse
- **Web dashboard** — login, health, cookie import, ops
- **Headless-friendly** — launch mode, HTTP proxy, systemd install

## Quick start

### Requirements

- Node.js 20+
- Google Chrome or Chromium

### Install & run

```bash
git clone https://github.com/linuxhsj/web-to-api.git
cd web-to-api
npm install
npm run build
npm run dev -- --browser-mode launch --port 3456
```

Open `http://127.0.0.1:3456` in your browser, log in to the providers you need, then verify:

```bash
curl http://127.0.0.1:3456/admin/health
curl http://127.0.0.1:3456/v1/models
```

### Smoke test

```bash
curl http://127.0.0.1:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "messages": [{"role": "user", "content": "Reply with one word: ok"}],
    "stream": false
  }'
```

## Client configuration

Point any OpenAI-compatible client at:

```text
Base URL:  http://127.0.0.1:3456/v1
API key:   any string (ignored unless --auth-token is set)
```

Use **`/v1/chat/completions`**, not `/v1/responses`.

Example with the OpenAI Node SDK:

```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://127.0.0.1:3456/v1',
  apiKey: 'local',
});

const res = await client.chat.completions.create({
  model: 'auto',
  messages: [{ role: 'user', content: 'Hello!' }],
});
console.log(res.choices[0].message.content);
```

## Models

| Model ID | Provider |
|----------|----------|
| `auto` | Fallback chain (recommended) |
| `deepseek-web/deepseek-v4-flash` | DeepSeek |
| `deepseek-web/deepseek-v4-flash-reasoner` | DeepSeek |
| `deepseek-web/deepseek-v4-pro` | DeepSeek |
| `deepseek-web/deepseek-v4-pro-reasoner` | DeepSeek |
| `kimi-web/kimi-k2.5` | Kimi |
| `qwen-web/qwen3.7-plus` | Qwen |
| `qwen-web/qwen3.7-max` | Qwen |
| `qwen-web/qwen3.6-plus` | Qwen |

## CLI options

```bash
web-to-api [options]

  -p, --port <port>              Listen port (default: 3456)
  --host <host>                  Bind address (default: 127.0.0.1)
  --auth-token <token>           Require Bearer token for /v1 and /admin
  --browser-mode <mode>          attach | launch (default: attach)
  --chrome-profile <dir>         Chrome user data directory
  --proxy-server <url>           HTTP proxy for browser traffic
  --proxy-user / --proxy-pass    Proxy credentials
  --state-dir <dir>              Data directory (default: ~/.web-to-api)
  --no-open                      Skip opening dashboard
```

## Cookie refresh

Import browser state without manual profile editing:

```bash
# Place state files in ~/.web-to-api/
# deepseek-state.json, kimi.json, qwen.json, etc.

npm run cookies:refresh -- --status
npm run cookies:refresh
```

Or upload JSON via the dashboard **Cookie / State Upload** section.

## Environment variables

| Variable | Description |
|----------|-------------|
| `WTA_PORT` | Listen port |
| `WTA_HOST` | Bind address |
| `WTA_AUTH_TOKEN` | API bearer token |
| `WTA_STATE_DIR` | State directory |
| `WTA_PROXY_SERVER` | Browser HTTP proxy |
| `WTA_PROXY_USER` / `WTA_PROXY_PASS` | Proxy auth |
| `WTA_TELEGRAM_BOT_TOKEN` | Error alerts (optional) |
| `WTA_TELEGRAM_CHAT_ID` | Telegram chat ID |

## Admin API

Management endpoints (also available in the dashboard):

| Endpoint | Description |
|----------|-------------|
| `GET /admin/health` | Server & provider health |
| `GET /admin/providers` | Provider list & auth status |
| `POST /admin/auth/login` | Start browser login flow |
| `POST /admin/auth/import-state` | Import cookies / storage state |

## Development

```bash
npm run typecheck
npm run test:unit
npm run dev
```

## Security

- Binds to `127.0.0.1` by default — do not expose publicly without `--auth-token`.
- Session cookies live in the Chromium profile and state directory. Do not commit them.
- Use a dedicated browser profile, not your daily driver.

## License

MIT — see [LICENSE](LICENSE).

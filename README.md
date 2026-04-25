# mon (মন)

> Bengali for *mind*. A Cloudflare-native memory layer for AI tools.

One Worker. One D1 table. One Vectorize index. Any AI tool that speaks MCP can plug in.

**Deploy in under 5 minutes. $0 to run.**

---

## Why mon exists

Most AI tools still treat memory as an add-on. mon makes memory a tiny, deployable primitive: ingest a thought, search it semantically, expose it over MCP, and plug it into any AI workflow.

## What it does

- **Capture** a thought via `POST /ingest`
- **Recall** semantically via `GET /search?q=`
- **Expose** `recall_memory` and `save_memory` MCP tools for MCP-compatible clients and agent runtimes (via your Worker's `/mcp` endpoint).

No Supabase. No Postgres. Built natively on Cloudflare.

---

## Stack

| Layer | Technology |
|---|---|
| Compute | Cloudflare Workers |
| Structured storage | Cloudflare D1 (SQLite) |
| Vector search | Cloudflare Vectorize |
| Embeddings | Workers AI (`@cf/baai/bge-small-en-v1.5`) |
| Protocol | MCP (Model Context Protocol) |

---

## Quick start

### 1. Prerequisites

- [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) installed
- Node.js 18+

### 2. Clone and install

```bash
git clone https://github.com/ibraasif/mon.git
cd mon
npm install
```

### 3. Create D1 database

```bash
wrangler d1 create app-mon-db
```

Copy the `database_id` from the output and paste it into `wrangler.toml`.

### 4. Create Vectorize index

```bash
wrangler vectorize create mon-index --dimensions=384 --metric=cosine
```

### 5. Apply schema

```bash
wrangler d1 execute app-mon-db --file=schema.sql --remote
```

### 6. Set auth token

mon protects all endpoints with a bearer token. Set it as a Wrangler secret — never hardcode it:

```bash
wrangler secret put AUTH_TOKEN
```

You'll be prompted to enter the token value. Use a strong random string (e.g. a UUID or 32+ character random value).

### 7. Deploy

```bash
wrangler deploy
```

That's it. Your memory endpoint is live at your Worker URL.

---

## API

All endpoints require `Authorization: Bearer <your-token>`.

### `POST /ingest`

Store and embed a thought.

```bash
curl -X POST https://mon.your-domain.com/ingest \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-token>" \
  -d '{"text": "Your thought here."}'
```

**Response**
```json
{ "id": "uuid", "status": "stored" }
```

---

### `GET /search?q=`

Recall semantically similar thoughts.

```bash
curl "https://mon.your-domain.com/search?q=your+query" \
  -H "Authorization: Bearer <your-token>"
```

**Response**
```json
{
  "results": [
    {
      "id": "uuid",
      "text": "Your thought here.",
      "created_at": "2026-04-24T03:27:38Z",
      "score": 0.75993013
    }
  ]
}
```

---

## MCP

mon exposes two MCP tools over a single `/mcp` endpoint using the [MCP Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports) (JSON-RPC 2.0). All MCP requests require the same bearer token.

| Tool | Description |
|---|---|
| `recall_memory` | Semantic search over your stored thoughts |
| `save_memory` | Store a new thought or piece of information |

### Client compatibility

| Client | Status | Notes |
|---|---|---|
| claude.ai (web) | ✅ Working | Streamable HTTP + bearer token header |
| Claude Desktop | ✅ Working | Via `mcp-remote` stdio bridge |
| Perplexity | ❌ Not supported | Requires persistent SSE — incompatible with Cloudflare Workers |

### claude.ai

1. Go to **Settings → Integrations → Add custom connector**
2. URL: `https://mon.your-domain.com/mcp`
3. Transport: **Streamable HTTP**
4. Authentication: **API Key** → add header `Authorization: Bearer <your-token>`

### Claude Desktop

Claude Desktop uses stdio, not HTTP. Use [`mcp-remote`](https://github.com/geelen/mcp-remote) as a bridge.

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mon": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://mon.your-domain.com/mcp",
        "--header",
        "Authorization: Bearer <your-token>"
      ]
    }
  }
}
```

Config file locations:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

### Why not Perplexity?

Perplexity's Streamable HTTP client opens a persistent GET SSE stream after `initialize` for server-to-client notifications. Cloudflare Workers terminate long-lived connections — making this architecturally incompatible without [Durable Objects](https://developers.cloudflare.com/durable-objects/). PRs welcome.

---

## License

[FSL-1.1-MIT](./LICENSE.md) — Source-available under FSL-1.1-MIT; each release converts to MIT after 2 years.

---

## Roadmap

See [ROADMAP.md](./ROADMAP.md) for what's coming after v0.

---

*Built by [@ibraasif](https://github.com/ibraasif). Inspired by the problem [OB1](https://github.com/NateBJones-Projects/OB1) solves — rebuilt from scratch for the Cloudflare ecosystem.*
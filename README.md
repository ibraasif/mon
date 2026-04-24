# mon (মন)

> Bengali for *mind*. A Cloudflare-native memory layer for AI tools.

One Worker. One D1 table. One Vectorize index. Any AI tool that speaks MCP can plug in.


**Deploy in under 5 minutes. $0 to run.**

Live demo: https://mon.ibrahimasif.com

Use this only for trying mon out. For real usage, deploy your own instance and call your own Worker URL.
---

## Why mon exists

Most AI tools still treat memory as an add-on. mon makes memory a tiny, deployable primitive: ingest a thought, search it semantically, expose it over MCP, and plug it into any AI workflow.

## What it does

- **Capture** a thought via `POST /ingest`
- **Recall** semantically via `GET /search?q=`
- **Expose** a recall_memory MCP tool for MCP-compatible clients and agent runtimes (via your Worker’s /mcp endpoint).

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

### 6. Deploy

```bash
wrangler deploy
```

That’s it. Your memory endpoint is live.
You can find your Worker URL in the Cloudflare dashboard and use it as mon.your-domain.com in the examples below.

---

## API

### `POST /ingest`

Store and embed a thought.

```bash
curl -X POST https://mon.your-domain.com/ingest \
  -H "Content-Type: application/json" \
  -d '{"text": "Your thought here."}'
```
Replace mon.your-domain.com with your deployed Worker hostname (for example, mon.yourname.workers.dev or your custom domain).

**Example Response**
```json
{ "id": "uuid", "status": "stored" }
```

---

### `GET /search?q=`

Recall semantically similar thoughts.

```bash
curl "https://mon.your-domain.com/search?q=your+query"
```
Replace mon.your-domain.com with your deployed Worker hostname.

**Example Response**
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

### MCP tool: `recall_memory`

Point any MCP-compatible AI tool at your mon MCP endpoint, for example:
https://mon.your-domain.com/mcp
The `recall_memory` tool accepts a natural language query and returns relevant thoughts from your memory store.

The demo instance lives at https://mon.ibrahimasif.com/mcp, but in your own setup you should use your deployed Worker URL instead.
---

## License

[FSL-1.1-MIT](./LICENSE.md) — Source-available under FSL-1.1-MIT; each release converts to MIT after 2 years.

---

## Roadmap

See [ROADMAP.md](./ROADMAP.md) for what's coming after v0.

---

*Built by [@ibraasif](https://github.com/ibraasif). Inspired by the problem [OB1](https://github.com/NateBJones-Projects/OB1) solves — rebuilt from scratch for the Cloudflare ecosystem.*

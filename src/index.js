export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (request.method === 'POST' && url.pathname === '/ingest') {
            return handleIngest(request, env);
        }
        if (request.method === 'GET' && url.pathname === '/search') {
            return handleSearch(url, env);
        }
        if (url.pathname === '/mcp') {
            return handleMCP(request, env);
        }

        return new Response('mon — Cloudflare-native AI memory layer', { status: 200 });
    }
};

// ─── MCP Handler (JSON-RPC 2.0 over HTTP) ────────────────────────────────────

async function handleMCP(request, env) {
    // Claude.ai sends OPTIONS first (CORS preflight)
    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (request.method !== 'POST') {
        return json({ error: 'Method not allowed' }, 405);
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return jsonRpcError(null, -32700, 'Parse error');
    }

    const { jsonrpc, id, method, params } = body;

    if (jsonrpc !== '2.0') {
        return jsonRpcError(id, -32600, 'Invalid Request: jsonrpc must be "2.0"');
    }

    switch (method) {
        case 'initialize':
            return jsonRpcResult(id, {
                protocolVersion: '2024-11-05',
                serverInfo: { name: 'mon', version: '0.0.1' },
                capabilities: { tools: {} }
            });

        case 'notifications/initialized':
            // Client acknowledgement — no response needed
            return new Response(null, { status: 204, headers: corsHeaders() });

        case 'tools/list':
            return jsonRpcResult(id, {
                tools: [{
                    name: 'recall_memory',
                    description: 'Search your personal memory store semantically.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            query: { type: 'string', description: 'Natural language query' }
                        },
                        required: ['query']
                    }
                },
                {
                    name: 'save_memory',
                    description: 'Save a thought or piece of information to your memory store.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            text: { type: 'string', description: 'The thought or information to store' }
                        },
                        required: ['text']
                    }
                }]
            });

        case 'tools/call': {
            const toolName = params?.name;
            const toolInput = params?.arguments ?? {};

            if (toolName === 'recall_memory') {
                const { query } = toolInput;
                if (!query) return jsonRpcError(id, -32602, 'Missing required argument: query');
                const fakeUrl = new URL(request.url);
                fakeUrl.pathname = '/search';
                fakeUrl.searchParams.set('q', query);
                const searchRes = await handleSearch(fakeUrl, env);
                const data = await searchRes.json();
                return jsonRpcResult(id, {
                    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }]
                });
            }

            if (toolName === 'save_memory') {
                const { text } = toolInput;
                if (!text) return jsonRpcError(id, -32602, 'Missing required argument: text');
                const fakeReq = new Request(request.url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text })
                });
                const ingestRes = await handleIngest(fakeReq, env);
                const data = await ingestRes.json();
                return jsonRpcResult(id, {
                    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }]
                });
            }

            return jsonRpcError(id, -32601, `Unknown tool: ${toolName}`);
        }

        default:
            return jsonRpcError(id, -32601, `Method not found: ${method}`);
    }
}

// ─── Ingest & Search (unchanged) ─────────────────────────────────────────────

async function handleIngest(request, env) {
    const { text } = await request.json();
    if (!text) return json({ error: 'text is required' }, 400);

    const id = crypto.randomUUID();
    const embedding = await embed(text, env);

    await env.DB.prepare(
        'INSERT INTO thoughts (id, text) VALUES (?, ?)'
    ).bind(id, text).run();

    await env.VECTORIZE.insert([{ id, values: embedding }]);

    return json({ id, status: 'stored' });
}

async function handleSearch(url, env) {
    const q = url.searchParams.get('q');
    if (!q) return json({ error: 'q is required' }, 400);

    const embedding = await embed(q, env);
    const matches = await env.VECTORIZE.query(embedding, { topK: 5 });

    if (!matches.matches.length) return json({ results: [] });

    const ids = matches.matches.map(m => m.id);
    const placeholders = ids.map(() => '?').join(',');
    const rows = await env.DB.prepare(
        `SELECT id, text, created_at FROM thoughts WHERE id IN (${placeholders})`
    ).bind(...ids).all();

    const scores = Object.fromEntries(matches.matches.map(m => [m.id, m.score]));
    const results = rows.results
        .map(r => ({ ...r, score: scores[r.id] }))
        .sort((a, b) => b.score - a.score);

    return json({ results });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function embed(text, env) {
    const result = await env.AI.run('@cf/baai/bge-small-en-v1.5', { text: [text] });
    return result.data[0];
}

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
}

function jsonRpcResult(id, result) {
    return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
}

function jsonRpcError(id, code, message) {
    return new Response(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }), {
        status: 200, // JSON-RPC errors still return HTTP 200
        headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
}
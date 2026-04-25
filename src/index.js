export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders(request) });
        }

        if (url.pathname === '/' || url.pathname === '') {
            return new Response('mon — Cloudflare-native AI memory layer', { status: 200 });
        }

        const authError = requireAuth(request, env);
        if (authError) return authError;

        if (request.method === 'POST' && url.pathname === '/ingest') {
            return handleIngest(request, env);
        }
        if (request.method === 'GET' && url.pathname === '/search') {
            return handleSearch(url, env);
        }
        if (url.pathname === '/mcp') {
            return handleMCP(request, env);
        }

        return new Response('Not found', { status: 404 });
    }
};

function requireAuth(request, env) {
    const token = env.AUTH_TOKEN;
    if (!token) {
        return new Response(
            JSON.stringify({ error: 'Server misconfigured: AUTH_TOKEN not set' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
    const authHeader = request.headers.get('Authorization') ?? '';
    const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (provided !== token) {
        return new Response(
            JSON.stringify({ error: 'Unauthorized' }),
            { status: 401, headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer', ...corsHeaders(request) } }
        );
    }
    return null;
}

const ALLOWED_ORIGINS = ['https://claude.ai', 'https://api.anthropic.com'];

function validateOrigin(request) {
    const origin = request.headers.get('Origin');
    if (!origin) return true;
    return ALLOWED_ORIGINS.includes(origin);
}

function corsHeaders(request) {
    const origin = request.headers.get('Origin');
    const allowedOrigin = (origin && ALLOWED_ORIGINS.includes(origin)) ? origin : '*';
    return {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id',
        'Access-Control-Expose-Headers': 'Mcp-Session-Id',
    };
}

async function handleMCP(request, env) {
    if (!validateOrigin(request)) {
        return new Response('Forbidden: invalid origin', { status: 403 });
    }

    if (request.method === 'GET') {
        const accept = request.headers.get('Accept') ?? '';
        if (accept.includes('text/event-stream')) {
            const body = new ReadableStream({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode(': ping\n\n'));
                    controller.close();
                }
            });
            return new Response(body, {
                status: 200,
                headers: { ...corsHeaders(request), 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }
            });
        }
        return new Response(JSON.stringify({ name: 'mon', version: '0.0.1', transport: 'streamable-http', endpoint: '/mcp' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
        });
    }

    if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405, headers: corsHeaders(request) });
    }

    let body;
    try { body = await request.json(); }
    catch { return jsonRpcError(null, -32700, 'Parse error', request); }

    const { jsonrpc, id, method, params } = body;
    if (jsonrpc !== '2.0') return jsonRpcError(id, -32600, 'Invalid Request', request);

    switch (method) {
        case 'initialize':
            return jsonRpcResult(id, {
                protocolVersion: '2024-11-05',
                serverInfo: { name: 'mon', version: '0.0.1' },
                capabilities: { tools: {} }
            }, request);

        case 'notifications/initialized':
            return new Response(null, { status: 204, headers: corsHeaders(request) });

        case 'ping':
            return jsonRpcResult(id, {}, request);

        case 'tools/list':
            return jsonRpcResult(id, {
                tools: [
                    {
                        name: 'recall_memory',
                        description: 'Search your personal memory store semantically.',
                        inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Natural language query' } }, required: ['query'] }
                    },
                    {
                        name: 'save_memory',
                        description: 'Save a thought or piece of information to your memory store.',
                        inputSchema: { type: 'object', properties: { text: { type: 'string', description: 'The thought or information to store' } }, required: ['text'] }
                    }
                ]
            }, request);

        case 'tools/call': {
            const toolName = params?.name;
            const toolInput = params?.arguments ?? {};

            if (toolName === 'recall_memory') {
                const { query } = toolInput;
                if (!query) return jsonRpcError(id, -32602, 'Missing required argument: query', request);
                const fakeUrl = new URL(request.url);
                fakeUrl.pathname = '/search';
                fakeUrl.searchParams.set('q', query);
                const data = await (await handleSearch(fakeUrl, env)).json();
                return jsonRpcResult(id, { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }, request);
            }

            if (toolName === 'save_memory') {
                const { text } = toolInput;
                if (!text) return jsonRpcError(id, -32602, 'Missing required argument: text', request);
                const fakeReq = new Request(request.url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text })
                });
                const data = await (await handleIngest(fakeReq, env)).json();
                return jsonRpcResult(id, { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }, request);
            }

            return jsonRpcError(id, -32601, `Unknown tool: ${toolName}`, request);
        }

        default:
            return jsonRpcError(id, -32601, `Method not found: ${method}`, request);
    }
}

async function handleIngest(request, env) {
    const { text } = await request.json();
    if (!text) return json({ error: 'text is required' }, 400);
    const id = crypto.randomUUID();
    const embedding = await embed(text, env);
    await env.DB.prepare('INSERT INTO thoughts (id, text) VALUES (?, ?)').bind(id, text).run();
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
    const rows = await env.DB.prepare(`SELECT id, text, created_at FROM thoughts WHERE id IN (${placeholders})`).bind(...ids).all();
    const scores = Object.fromEntries(matches.matches.map(m => [m.id, m.score]));
    const results = rows.results.map(r => ({ ...r, score: scores[r.id] })).sort((a, b) => b.score - a.score);
    return json({ results });
}

async function embed(text, env) {
    const result = await env.AI.run('@cf/baai/bge-small-en-v1.5', { text: [text] });
    return result.data[0];
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function jsonRpcResult(id, result, request) {
    return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    });
}

function jsonRpcError(id, code, message, request) {
    return new Response(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...(request ? corsHeaders(request) : {}) }
    });
}
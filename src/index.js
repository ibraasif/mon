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

async function handleMCP(request, env) {
    if (request.method === 'GET') {
        return json({
            name: 'mon',
            version: '0.0.1',
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
            }]
        });
    }

    if (request.method === 'POST') {
        const body = await request.json();
        if (body.tool === 'recall_memory') {
            const fakeUrl = new URL(request.url);
            fakeUrl.pathname = '/search';
            fakeUrl.searchParams.set('q', body.input.query);
            return handleSearch(fakeUrl, env);
        }
    }

    return json({ error: 'not found' }, 404);
}

async function embed(text, env) {
    const result = await env.AI.run('@cf/baai/bge-small-en-v1.5', { text: [text] });
    return result.data[0];
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}
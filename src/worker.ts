interface Env {
  DB?: D1Database;
  MEDIA?: R2Bucket;
  ASSETS: Fetcher;
}

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=UTF-8');
  return new Response(JSON.stringify(data), { ...init, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return json({ ok: true, app: 'ServPerto', runtime: 'Cloudflare Workers' });
    }

    if (url.pathname === '/api/professionals' && request.method === 'GET') {
      if (!env.DB) {
        return json(
          { error: 'D1 ainda não foi vinculado. Adicione o binding DB no Cloudflare.' },
          { status: 503 },
        );
      }

      const { results } = await env.DB.prepare(
        `SELECT id, name, category, rating, latitude, longitude
         FROM professionals
         WHERE active = 1
         ORDER BY rating DESC
         LIMIT 50`,
      ).all();

      return json(results);
    }

    if (url.pathname.startsWith('/api/')) {
      return json({ error: 'Rota não encontrada' }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  },
};

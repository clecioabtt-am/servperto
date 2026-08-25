interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  MEDIA?: R2Bucket;
}

const enc = new TextEncoder();

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=UTF-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), { ...init, headers });
}

async function readBody(req: Request) {
  try { return await req.json() as Record<string, any>; }
  catch { return {}; }
}

function makeRecoveryCode() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, '0');
}

function randomHex(bytes = 16) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return [...a].map(x => x.toString(16).padStart(2, '0')).join('');
}

async function pbkdf2(secret: string, salt: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 150000, hash: 'SHA-256' },
    key,
    256
  );
  return [...new Uint8Array(bits)].map(x => x.toString(16).padStart(2, '0')).join('');
}

async function hashSecret(secret: string) {
  const salt = randomHex();
  return `${salt}$${await pbkdf2(secret, salt)}`;
}

async function verifySecret(secret: string, stored: string) {
  const [salt, expected] = String(stored || '').split('$');
  if (!salt || !expected) return false;
  return (await pbkdf2(secret, salt)) === expected;
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(value));
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
}

function slugify(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'servicos';
}

function publicCoordinates(lat: number | null, lng: number | null, exact: boolean) {
  if (lat == null || lng == null) return { lat: null, lng: null };
  if (exact) return { lat, lng };
  // Aproxima para ~1 km para não expor endereço residencial exato.
  return { lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100 };
}

function roleFromPayload(value: unknown) {
  return value === 'professional' || value === 'provider' ? 'provider' : 'client';
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return json({ ok: true, app: 'ServPerto', runtime: 'Cloudflare Workers', database: Boolean(env.DB) });
    }

    if (url.pathname === '/api/db-health') {
      if (!env.DB) return json({ ok: false, database: false, error: 'Binding DB não encontrado.' }, { status: 503 });
      try {
        const row: any = await env.DB.prepare("SELECT COUNT(*) AS total FROM sqlite_master WHERE type='table'").first();
        const users: any = await env.DB.prepare('SELECT COUNT(*) AS total FROM users').first();
        return json({ ok: true, database: true, tables: Number(row?.total || 0), users: Number(users?.total || 0) });
      } catch (e: any) {
        return json({ ok: false, database: true, error: String(e?.message || e) }, { status: 500 });
      }
    }

    if (url.pathname.startsWith('/api/') && !env.DB) {
      return json({ error: 'Banco D1 não vinculado. Adicione o binding DB ao Worker servperto.' }, { status: 503 });
    }

    const db = env.DB;

    if (url.pathname === '/api/auth/register' && request.method === 'POST') {
      const b = await readBody(request);
      const role = roleFromPayload(b.role);
      const required = ['name', 'phone', 'cep', 'city', 'address', 'username', 'password'];
      for (const f of required) {
        if (!String(b[f] || '').trim()) return json({ error: `Campo obrigatório: ${f}` }, { status: 400 });
      }

      const username = String(b.username).trim().toLowerCase();
      if (String(b.password).length < 8) return json({ error: 'A senha precisa ter pelo menos 8 caracteres.' }, { status: 400 });
      if (!/^[a-z0-9._-]{4,40}$/.test(username)) return json({ error: 'Nome de login inválido. Use 4 a 40 caracteres, sem espaços.' }, { status: 400 });

      const exists = await db.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
      if (exists) return json({ error: 'Este nome de login já está em uso.' }, { status: 409 });

      const recoveryCode = makeRecoveryCode();
      const passwordHash = await hashSecret(String(b.password));
      const recoveryHash = await hashSecret(recoveryCode);
      const lat = Number.isFinite(Number(b.latitude)) ? Number(b.latitude) : null;
      const lng = Number.isFinite(Number(b.longitude)) ? Number(b.longitude) : null;
      const exact = b.showExactLocation === '1' || b.showExactLocation === true;
      const pub = publicCoordinates(lat, lng, exact);

      try {
        const inserted = await db.prepare(`
          INSERT INTO users (
            role, full_name, phone, cep, address, city, state, username,
            password_hash, recovery_code_hash, recovery_attempts, active,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'AM', ?, ?, ?, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).bind(
          role,
          String(b.name).trim(),
          String(b.phone).trim(),
          String(b.cep).trim(),
          String(b.address).trim(),
          String(b.city).trim(),
          username,
          passwordHash,
          recoveryHash
        ).run();

        const userId = Number(inserted.meta.last_row_id);

        if (role === 'provider') {
          const categoryName = String(b.category || 'Serviços').trim();
          const categorySlug = slugify(categoryName);

          await db.prepare(`
            INSERT OR IGNORE INTO service_categories (name, slug, active, created_at)
            VALUES (?, ?, 1, CURRENT_TIMESTAMP)
          `).bind(categoryName, categorySlug).run();

          const category: any = await db.prepare('SELECT id FROM service_categories WHERE slug = ?').bind(categorySlug).first();

          const profile = await db.prepare(`
            INSERT INTO provider_profiles (
              user_id, professional_name, description, latitude, longitude,
              exact_location_public, average_rating, total_reviews, verified,
              available, plan, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 1, 'free', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          `).bind(
            userId,
            String(b.name).trim(),
            String(b.description || '').trim(),
            pub.lat,
            pub.lng,
            exact ? 1 : 0
          ).run();

          const providerId = Number(profile.meta.last_row_id);
          if (category?.id) {
            await db.prepare(`
              INSERT INTO provider_services (
                provider_id, category_id, title, description, active, created_at, updated_at
              ) VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `).bind(providerId, category.id, categoryName, String(b.description || '').trim()).run();
          }
        }

        return json({ ok: true, role, recoveryCode }, { status: 201 });
      } catch (e: any) {
        return json({ error: 'Não foi possível criar o cadastro.', detail: String(e?.message || e) }, { status: 500 });
      }
    }

    if (url.pathname === '/api/auth/login' && request.method === 'POST') {
      const b = await readBody(request);
      const username = String(b.username || '').trim().toLowerCase();
      const user: any = await db.prepare(`
        SELECT id, full_name, username, role, password_hash, active
        FROM users WHERE username = ?
      `).bind(username).first();

      if (!user || !user.active || !(await verifySecret(String(b.password || ''), user.password_hash))) {
        return json({ error: 'Login ou senha inválidos.' }, { status: 401 });
      }

      const token = `${randomHex(24)}${randomHex(24)}`;
      const tokenHash = await sha256Hex(token);
      const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      await db.prepare('INSERT INTO sessions (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)')
        .bind(user.id, tokenHash, expires).run();

      return json({
        ok: true,
        token,
        expiresAt: expires,
        user: { id: user.id, name: user.full_name, username: user.username, role: user.role }
      });
    }

    if (url.pathname === '/api/auth/recover' && request.method === 'POST') {
      const b = await readBody(request);
      const username = String(b.username || '').trim().toLowerCase();
      const user: any = await db.prepare(`
        SELECT id, recovery_code_hash, recovery_attempts, recovery_locked_until
        FROM users WHERE username = ? AND active = 1
      `).bind(username).first();

      if (!user) return json({ error: 'Dados de recuperação inválidos.' }, { status: 400 });
      if (user.recovery_locked_until && Date.parse(user.recovery_locked_until) > Date.now()) {
        return json({ error: 'Muitas tentativas. Tente novamente mais tarde.' }, { status: 429 });
      }

      const valid = await verifySecret(String(b.recoveryCode || ''), user.recovery_code_hash);
      if (!valid) {
        const attempts = Number(user.recovery_attempts || 0) + 1;
        const lock = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
        await db.prepare(`
          UPDATE users SET recovery_attempts = ?, recovery_locked_until = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
        `).bind(attempts >= 5 ? 0 : attempts, lock, user.id).run();
        return json({ error: 'Dados de recuperação inválidos.' }, { status: 400 });
      }

      if (String(b.newPassword || '').length < 8) {
        return json({ error: 'A nova senha precisa ter pelo menos 8 caracteres.' }, { status: 400 });
      }

      const passwordHash = await hashSecret(String(b.newPassword));
      await db.prepare(`
        UPDATE users
        SET password_hash = ?, recovery_attempts = 0, recovery_locked_until = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(passwordHash, user.id).run();

      // Revoga sessões antigas após troca de senha.
      await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id).run();
      return json({ ok: true });
    }

    if (url.pathname === '/api/geocode' && request.method === 'GET') {
      const q = String(url.searchParams.get('q') || '').trim();
      if (q.length < 5 || q.length > 220) return json({ error: 'Endereço inválido.' }, { status: 400 });
      try {
        const endpoint = new URL('https://nominatim.openstreetmap.org/search');
        endpoint.searchParams.set('q', q);
        endpoint.searchParams.set('format', 'jsonv2');
        endpoint.searchParams.set('limit', '1');
        endpoint.searchParams.set('countrycodes', 'br');
        endpoint.searchParams.set('addressdetails', '1');
        const res = await fetch(endpoint.toString(), {
          headers: {
            'User-Agent': 'ServPerto/0.6 (Cloudflare Worker; contact: admin@servperto.local)',
            'Accept-Language': 'pt-BR,pt;q=0.9'
          }
        });
        if (!res.ok) return json({ error: 'Serviço de localização temporariamente indisponível.' }, { status: 502 });
        const rows: any[] = await res.json();
        const hit = rows?.[0];
        if (!hit) return json({ error: 'Endereço não encontrado.' }, { status: 404 });
        return json({
          ok: true,
          latitude: Number(hit.lat),
          longitude: Number(hit.lon),
          displayName: hit.display_name || null,
          source: 'OpenStreetMap/Nominatim'
        });
      } catch (e: any) {
        return json({ error: 'Falha ao localizar endereço.', detail: String(e?.message || e) }, { status: 500 });
      }
    }

    if (url.pathname === '/api/professionals' && request.method === 'GET') {
      const { results } = await db.prepare(`
        SELECT
          pp.id,
          COALESCE(pp.professional_name, u.full_name) AS name,
          COALESCE(sc.name, ps.title, 'Serviços') AS category,
          COALESCE(pp.description, ps.description, '') AS description,
          u.phone,
          u.city,
          CASE WHEN pp.exact_location_public = 1 THEN u.address ELSE NULL END AS address,
          pp.average_rating AS rating,
          pp.total_reviews AS review_count,
          pp.latitude,
          pp.longitude
        FROM provider_profiles pp
        JOIN users u ON u.id = pp.user_id
        LEFT JOIN provider_services ps ON ps.provider_id = pp.id AND ps.active = 1
        LEFT JOIN service_categories sc ON sc.id = ps.category_id AND sc.active = 1
        WHERE u.active = 1
          AND pp.available = 1
          AND pp.latitude IS NOT NULL
          AND pp.longitude IS NOT NULL
        GROUP BY pp.id
        ORDER BY pp.average_rating DESC, pp.total_reviews DESC, pp.id DESC
        LIMIT 100
      `).all();
      return json(results);
    }

    if (url.pathname.startsWith('/api/')) return json({ error: 'Rota não encontrada.' }, { status: 404 });
    return env.ASSETS.fetch(request);
  }
};

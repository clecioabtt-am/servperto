interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  MEDIA?: R2Bucket;
}

const enc = new TextEncoder();
const PBKDF2_ITERATIONS = 100_000;

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=UTF-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), { ...init, headers });
}

async function readBody(req: Request) {
  try { return await req.json() as Record<string, any>; } catch { return {}; }
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
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' }, key, 256);
  return [...new Uint8Array(bits)].map(x => x.toString(16).padStart(2, '0')).join('');
}
async function hashSecret(secret: string) { const salt = randomHex(); return `${salt}$${await pbkdf2(secret, salt)}`; }
async function verifySecret(secret: string, stored: string) {
  const [salt, expected] = String(stored || '').split('$');
  return Boolean(salt && expected && (await pbkdf2(secret, salt)) === expected);
}
async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(value));
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
}
function slugify(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'servicos';
}
function publicCoordinates(lat: number | null, lng: number | null, exact: boolean) {
  if (lat == null || lng == null) return { lat: null, lng: null };
  return exact ? { lat, lng } : { lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100 };
}
function roleFromPayload(value: unknown) { return value === 'professional' || value === 'provider' ? 'provider' : 'client'; }
function money(value: unknown) { const n = Number(value); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null; }

async function sessionUser(request: Request, db: D1Database) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row: any = await db.prepare(`
    SELECT u.id, u.full_name, u.username, u.role, u.phone, u.cep, u.address, u.city, u.state, u.profile_image, u.whatsapp_public, u.last_seen, s.id AS session_id, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND u.active = 1
  `).bind(tokenHash).first();
  if (!row || Date.parse(row.expires_at) <= Date.now()) return null;
  return row;
}

async function providerForUser(db: D1Database, userId: number) {
  return await db.prepare(`SELECT pp.*, u.full_name, u.phone, u.cep, u.address, u.city, u.state, u.whatsapp_public, u.last_seen FROM provider_profiles pp JOIN users u ON u.id=pp.user_id WHERE pp.user_id=?`).bind(userId).first() as any;
}


async function notify(db:D1Database,userId:number,title:string,message:string,kind='general',requestId:number|null=null){
  try{await db.prepare(`INSERT INTO notifications(user_id,title,message,kind,link_request_id,created_at) VALUES(?,?,?,?,?,CURRENT_TIMESTAMP)`).bind(userId,title,message,kind,requestId).run()}catch{}
}

async function refreshProviderRating(db: D1Database, providerId: number) {
  const row: any = await db.prepare(`SELECT COALESCE(AVG(rating),0) AS avg_rating, COUNT(*) AS total FROM reviews WHERE provider_id=?`).bind(providerId).first();
  await db.prepare(`UPDATE provider_profiles SET average_rating=?, total_reviews=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .bind(Number(row?.avg_rating || 0), Number(row?.total || 0), providerId).run();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/health') return json({ ok: true, app: 'ServPerto', version: '1.4.0', runtime: 'Cloudflare Workers', database: Boolean(env.DB) });
      if (url.pathname.startsWith('/api/') && !env.DB) return json({ error: 'Banco D1 não vinculado. Adicione o binding DB ao Worker servperto.' }, { status: 503 });
      const db = env.DB;

      if (url.pathname === '/api/db-health') {
        const row: any = await db.prepare("SELECT COUNT(*) AS total FROM sqlite_master WHERE type='table'").first();
        const users: any = await db.prepare('SELECT COUNT(*) AS total FROM users').first();
        return json({ ok: true, database: true, tables: Number(row?.total || 0), users: Number(users?.total || 0), version: '1.4.0' });
      }

      if (url.pathname === '/api/schema-health') {
        const expected: Record<string, string[]> = {
          users: ['id','role','full_name','phone','cep','address','city','state','username','password_hash','recovery_code_hash','active','profile_image','whatsapp_public','last_seen'],
          provider_profiles: ['id','user_id','professional_name','description','latitude','longitude','available','plan','map_visible','live_location_enabled','live_location_updated_at'],
          provider_services: ['id','provider_id','category_id','title','active'],
          service_requests: ['id','client_id','target_provider_id','title','description','status','scheduled_at'],
          quotes: ['id','request_id','provider_id','price','message','status'],
          reviews: ['id','request_id','client_id','provider_id','rating'],
          favorites: ['id','client_id','provider_id'],
          service_chats: ['id','request_id','status','closed_by_user_id','created_at','updated_at'],
          chat_messages: ['id','chat_id','sender_user_id','message_type','message','latitude','longitude','created_at'],
          provider_portfolio: ['id','provider_id','file_url','file_type','caption'],
          notifications: ['id','user_id','title','message','kind','read_at','created_at']
        };
        const report: Record<string, any> = {}; let healthy = true;
        for (const [table, required] of Object.entries(expected)) {
          const rows: any = await db.prepare(`PRAGMA table_info(${table})`).all();
          const columns = (rows.results || []).map((r: any) => String(r.name));
          const missing = required.filter(c => !columns.includes(c));
          if (!columns.length || missing.length) healthy = false;
          report[table] = { exists: columns.length > 0, missing };
        }
        return json({ ok: healthy, database: true, version: '1.4.0', schema: report }, { status: healthy ? 200 : 500 });
      }

      if (url.pathname === '/api/auth/register' && request.method === 'POST') {
        const b = await readBody(request); const role = roleFromPayload(b.role);
        for (const f of ['name','phone','cep','city','address','username','password']) if (!String(b[f] || '').trim()) return json({ error: `Campo obrigatório: ${f}` }, { status: 400 });
        const username = String(b.username).trim().toLowerCase();
        if (String(b.password).length < 8) return json({ error: 'A senha precisa ter pelo menos 8 caracteres.' }, { status: 400 });
        if (!/^[a-z0-9._-]{4,40}$/.test(username)) return json({ error: 'Nome de login inválido. Use 4 a 40 caracteres, sem espaços.' }, { status: 400 });
        if (await db.prepare('SELECT id FROM users WHERE username=?').bind(username).first()) return json({ error: 'Este nome de login já está em uso.' }, { status: 409 });

        const recoveryCode = makeRecoveryCode(); const passwordHash = await hashSecret(String(b.password)); const recoveryHash = await hashSecret(recoveryCode);
        const lat = Number.isFinite(Number(b.latitude)) ? Number(b.latitude) : null; const lng = Number.isFinite(Number(b.longitude)) ? Number(b.longitude) : null;
        const exact = b.showExactLocation === '1' || b.showExactLocation === true; const pub = publicCoordinates(lat, lng, exact);
        let userId: number | null = null; let stage = 'users';
        try {
          const inserted: any = await db.prepare(`INSERT INTO users (role,full_name,phone,cep,address,city,state,username,password_hash,recovery_code_hash,recovery_attempts,active,created_at,updated_at) VALUES (?,?,?,?,?,?,'AM',?,?,?,0,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`)
            .bind(role,String(b.name).trim(),String(b.phone).trim(),String(b.cep).trim(),String(b.address).trim(),String(b.city).trim(),username,passwordHash,recoveryHash).run();
          userId = Number(inserted.meta.last_row_id);
          if (role === 'provider') {
            const categoryName = String(b.category || 'Serviços').trim(); const categorySlug = slugify(categoryName); stage = 'service_categories';
            await db.prepare(`INSERT OR IGNORE INTO service_categories(name,slug,active,created_at) VALUES(?,?,1,CURRENT_TIMESTAMP)`).bind(categoryName,categorySlug).run();
            const category: any = await db.prepare('SELECT id FROM service_categories WHERE slug=?').bind(categorySlug).first();
            stage = 'provider_profiles';
            const profile: any = await db.prepare(`INSERT INTO provider_profiles(user_id,professional_name,description,latitude,longitude,exact_location_public,average_rating,total_reviews,verified,available,plan,created_at,updated_at) VALUES(?,?,?,?,?,?,0,0,0,1,'free',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`)
              .bind(userId,String(b.name).trim(),String(b.description || '').trim(),pub.lat,pub.lng,exact ? 1 : 0).run();
            const providerId = Number(profile.meta.last_row_id);
            if (category?.id) {
              stage = 'provider_services'; const extra = String(b.services || '').split(',').map((x:string)=>x.trim()).filter(Boolean).slice(0,12); const titles = Array.from(new Set([categoryName,...extra]));
              for (const title of titles) await db.prepare(`INSERT INTO provider_services(provider_id,category_id,title,description,active,created_at,updated_at) VALUES(?,?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).bind(providerId,category.id,title,String(b.description || '').trim()).run();
            }
          }
          return json({ ok: true, role, recoveryCode }, { status: 201 });
        } catch (e:any) {
          if (userId) try { await db.prepare('DELETE FROM users WHERE id=?').bind(userId).run(); } catch {}
          return json({ error: 'Não foi possível criar o cadastro.', detail: `Falha na etapa ${stage}: ${String(e?.message || e)}` }, { status: 500 });
        }
      }

      if (url.pathname === '/api/auth/login' && request.method === 'POST') {
        const b = await readBody(request); const username = String(b.username || '').trim().toLowerCase();
        const user: any = await db.prepare('SELECT id,full_name,username,role,password_hash,active FROM users WHERE username=?').bind(username).first();
        if (!user || !user.active || !(await verifySecret(String(b.password || ''), user.password_hash))) return json({ error: 'Login ou senha inválidos.' }, { status: 401 });
        const token = `${randomHex(24)}${randomHex(24)}`; const tokenHash = await sha256Hex(token); const expires = new Date(Date.now()+7*86400000).toISOString();
        await db.prepare('INSERT INTO sessions(user_id,token_hash,expires_at,created_at) VALUES(?,?,?,CURRENT_TIMESTAMP)').bind(user.id,tokenHash,expires).run();
        await db.prepare('UPDATE users SET last_seen=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(user.id).run();
        return json({ ok:true, token, expiresAt:expires, user:{ id:user.id,name:user.full_name,username:user.username,role:user.role } });
      }

      if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
        const auth=request.headers.get('authorization')||''; const token=auth.startsWith('Bearer ')?auth.slice(7).trim():'';
        if(token){ const tokenHash=await sha256Hex(token); const sess:any=await db.prepare('SELECT user_id FROM sessions WHERE token_hash=?').bind(tokenHash).first(); if(sess?.user_id)await db.prepare("UPDATE users SET last_seen=datetime('now','-1 day'),updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(sess.user_id).run(); await db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(tokenHash).run(); } return json({ok:true});
      }

      if (url.pathname === '/api/auth/recover' && request.method === 'POST') {
        const b=await readBody(request); const username=String(b.username||'').trim().toLowerCase();
        const user:any=await db.prepare('SELECT id,recovery_code_hash,recovery_attempts,recovery_locked_until FROM users WHERE username=? AND active=1').bind(username).first();
        if(!user) return json({error:'Dados de recuperação inválidos.'},{status:400});
        if(user.recovery_locked_until&&Date.parse(user.recovery_locked_until)>Date.now()) return json({error:'Muitas tentativas. Tente novamente mais tarde.'},{status:429});
        if(!(await verifySecret(String(b.recoveryCode||''),user.recovery_code_hash))){ const attempts=Number(user.recovery_attempts||0)+1; const lock=attempts>=5?new Date(Date.now()+15*60000).toISOString():null; await db.prepare('UPDATE users SET recovery_attempts=?,recovery_locked_until=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(attempts>=5?0:attempts,lock,user.id).run(); return json({error:'Dados de recuperação inválidos.'},{status:400}); }
        if(String(b.newPassword||'').length<8) return json({error:'A nova senha precisa ter pelo menos 8 caracteres.'},{status:400});
        await db.prepare('UPDATE users SET password_hash=?,recovery_attempts=0,recovery_locked_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(await hashSecret(String(b.newPassword)),user.id).run();
        await db.prepare('DELETE FROM sessions WHERE user_id=?').bind(user.id).run(); return json({ok:true});
      }

      if (url.pathname === '/api/me' && request.method === 'GET') {
        const user:any=await sessionUser(request,db); if(!user) return json({error:'Sessão inválida ou expirada.'},{status:401});
        const base={id:user.id,name:user.full_name,username:user.username,role:user.role,phone:user.phone,cep:user.cep,address:user.address,city:user.city,state:user.state,image:user.profile_image||null,whatsappPublic:Boolean(user.whatsapp_public),lastSeen:user.last_seen||null};
        if(user.role!=='provider') return json({user:base});
        const provider:any=await providerForUser(db,user.id); if(provider?.live_location_enabled){ const live:any=await db.prepare(`SELECT CASE WHEN live_location_updated_at IS NOT NULL AND live_location_updated_at>=datetime('now','-90 seconds') THEN 1 ELSE 0 END AS active FROM provider_profiles WHERE id=?`).bind(provider.id).first(); provider.live_location_enabled=Number(live?.active||0); } const services:any=provider?await db.prepare(`SELECT ps.id,ps.title,ps.description,ps.price_from,ps.active,sc.name AS category FROM provider_services ps JOIN service_categories sc ON sc.id=ps.category_id WHERE ps.provider_id=? ORDER BY ps.created_at DESC`).bind(provider.id).all():{results:[]};
        return json({user:base,provider,services:services.results||[]});
      }

      if (url.pathname === '/api/categories' && request.method === 'GET') {
        const out:any=await db.prepare('SELECT id,name,slug FROM service_categories WHERE active=1 ORDER BY name').all(); return json(out.results||[]);
      }

      if (url.pathname === '/api/geocode' && request.method === 'GET') {
        const q=String(url.searchParams.get('q')||'').trim(); if(q.length<3||q.length>220) return json({error:'Endereço inválido.'},{status:400});
        const endpoint=new URL('https://nominatim.openstreetmap.org/search'); endpoint.searchParams.set('q',q); endpoint.searchParams.set('format','jsonv2'); endpoint.searchParams.set('limit','1'); endpoint.searchParams.set('countrycodes','br'); endpoint.searchParams.set('addressdetails','1');
        const res=await fetch(endpoint.toString(),{headers:{'User-Agent':'ServPerto/0.9 (Cloudflare Worker)','Accept-Language':'pt-BR,pt;q=0.9'}}); if(!res.ok)return json({error:'Serviço de localização temporariamente indisponível.'},{status:502});
        const rows:any[]=await res.json(); const hit=rows?.[0]; if(!hit)return json({error:'Endereço não encontrado.'},{status:404}); return json({ok:true,latitude:Number(hit.lat),longitude:Number(hit.lon),displayName:hit.display_name||null,source:'OpenStreetMap/Nominatim'});
      }

      const proMatch=url.pathname.match(/^\/api\/professionals\/(\d+)$/);
      if(proMatch&&request.method==='GET'){
        const providerId=Number(proMatch[1]); const professional:any=await db.prepare(`SELECT pp.id,COALESCE(pp.professional_name,u.full_name) AS name,COALESCE(sc.name,ps.title,'Serviços') AS category,COALESCE(pp.description,ps.description,'') AS description,u.city,CASE WHEN pp.exact_location_public=1 THEN u.address ELSE NULL END AS address,CASE WHEN u.whatsapp_public=1 THEN u.phone ELSE NULL END AS phone,pp.average_rating AS rating,pp.total_reviews AS review_count,CASE WHEN pp.map_visible=1 THEN pp.latitude ELSE NULL END AS latitude,CASE WHEN pp.map_visible=1 THEN pp.longitude ELSE NULL END AS longitude,pp.map_visible,pp.available,pp.verified,CASE WHEN pp.live_location_enabled=1 AND pp.live_location_updated_at>=datetime('now','-90 seconds') THEN 1 ELSE 0 END AS live_location_enabled,pp.live_location_updated_at,u.profile_image AS image,u.created_at AS joined_at,(SELECT COUNT(*) FROM service_requests x WHERE x.target_provider_id=pp.id AND x.status='completed') AS completed_count FROM provider_profiles pp JOIN users u ON u.id=pp.user_id LEFT JOIN provider_services ps ON ps.provider_id=pp.id AND ps.active=1 LEFT JOIN service_categories sc ON sc.id=ps.category_id AND sc.active=1 WHERE pp.id=? AND u.active=1 GROUP BY pp.id`).bind(providerId).first();
        if(!professional)return json({error:'Profissional não encontrado.'},{status:404});
        const services:any=await db.prepare('SELECT ps.id,ps.title,ps.description,ps.price_from,sc.name AS category FROM provider_services ps JOIN service_categories sc ON sc.id=ps.category_id WHERE ps.provider_id=? AND ps.active=1 ORDER BY ps.created_at').bind(providerId).all();
        const reviews:any=await db.prepare('SELECT r.id,r.rating,r.comment,r.created_at,u.full_name AS client_name FROM reviews r JOIN users u ON u.id=r.client_id WHERE r.provider_id=? ORDER BY r.created_at DESC LIMIT 30').bind(providerId).all();
        const portfolio:any=await db.prepare(`SELECT id,file_url,caption,created_at FROM provider_portfolio WHERE provider_id=? AND file_type='image' ORDER BY created_at DESC LIMIT 24`).bind(providerId).all();
        return json({professional,services:services.results||[],reviews:reviews.results||[],portfolio:portfolio.results||[]});
      }

      if(url.pathname==='/api/professionals'&&request.method==='GET'){
        const out:any=await db.prepare(`SELECT pp.id,COALESCE(pp.professional_name,u.full_name) AS name,COALESCE(sc.name,ps.title,'Serviços') AS category,COALESCE(pp.description,ps.description,'') AS description,u.city,CASE WHEN pp.exact_location_public=1 THEN u.address ELSE NULL END AS address,CASE WHEN u.whatsapp_public=1 THEN u.phone ELSE NULL END AS phone,pp.average_rating AS rating,pp.total_reviews AS review_count,CASE WHEN pp.map_visible=1 THEN pp.latitude ELSE NULL END AS latitude,CASE WHEN pp.map_visible=1 THEN pp.longitude ELSE NULL END AS longitude,pp.map_visible,pp.available,pp.verified,CASE WHEN pp.live_location_enabled=1 AND pp.live_location_updated_at>=datetime('now','-90 seconds') THEN 1 ELSE 0 END AS live_location_enabled,pp.live_location_updated_at,u.profile_image AS image,u.created_at AS joined_at,(SELECT COUNT(*) FROM service_requests x WHERE x.target_provider_id=pp.id AND x.status='completed') AS completed_count FROM provider_profiles pp JOIN users u ON u.id=pp.user_id LEFT JOIN provider_services ps ON ps.provider_id=pp.id AND ps.active=1 LEFT JOIN service_categories sc ON sc.id=ps.category_id AND sc.active=1 WHERE u.active=1 GROUP BY pp.id ORDER BY pp.average_rating DESC,pp.total_reviews DESC,pp.id DESC LIMIT 200`).all(); return json(out.results||[]);
      }

      // Solicitações: criar/listar
      if(url.pathname==='/api/service-requests'&&request.method==='POST'){
        const user:any=await sessionUser(request,db); if(!user)return json({error:'Faça login como cliente para solicitar um orçamento.'},{status:401}); if(user.role!=='client')return json({error:'Somente clientes podem solicitar orçamento.'},{status:403});
        const b=await readBody(request); const providerId=Number(b.providerId||0); const title=String(b.title||'').trim(); const description=String(b.description||'').trim(); const address=String(b.address||'').trim()||null;
        if(!providerId||!title||description.length<5)return json({error:'Preencha o serviço e descreva o que você precisa.'},{status:400});
        const provider:any=await db.prepare(`SELECT pp.id,sc.id AS category_id FROM provider_profiles pp LEFT JOIN provider_services ps ON ps.provider_id=pp.id AND ps.active=1 LEFT JOIN service_categories sc ON sc.id=ps.category_id JOIN users u ON u.id=pp.user_id WHERE pp.id=? AND u.active=1 AND pp.available=1 LIMIT 1`).bind(providerId).first();
        if(!provider)return json({error:'Profissional indisponível ou não encontrado.'},{status:404});
        const result:any=await db.prepare(`INSERT INTO service_requests(client_id,category_id,target_provider_id,title,description,address,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'open',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).bind(user.id,provider.category_id||null,providerId,title,description,address).run();
        const requestId=Number(result.meta?.last_row_id||0); const owner:any=await db.prepare('SELECT user_id FROM provider_profiles WHERE id=?').bind(providerId).first(); if(owner?.user_id)await notify(db,Number(owner.user_id),'Nova solicitação de serviço',`${user.full_name} solicitou: ${title}`,'request',requestId);
        return json({ok:true,requestId},{status:201});
      }

      if(url.pathname==='/api/service-requests'&&request.method==='GET'){
        const user:any=await sessionUser(request,db); if(!user)return json({error:'Sessão inválida ou expirada.'},{status:401});
        if(user.role==='client'){
          const out:any=await db.prepare(`SELECT sr.id,sr.title,sr.description,sr.address,sr.status,sr.created_at,sr.updated_at,sr.scheduled_at,sr.target_provider_id AS provider_id,COALESCE(pp.professional_name,pu.full_name) AS provider_name,sc.name AS category,q.id AS quote_id,q.price AS quote_price,q.message AS quote_message,q.status AS quote_status,r.id AS review_id FROM service_requests sr LEFT JOIN provider_profiles pp ON pp.id=sr.target_provider_id LEFT JOIN users pu ON pu.id=pp.user_id LEFT JOIN service_categories sc ON sc.id=sr.category_id LEFT JOIN quotes q ON q.request_id=sr.id AND q.provider_id=sr.target_provider_id LEFT JOIN reviews r ON r.request_id=sr.id WHERE sr.client_id=? ORDER BY sr.created_at DESC LIMIT 100`).bind(user.id).all(); return json({requests:out.results||[]});
        }
        const provider:any=await providerForUser(db,user.id); if(!provider)return json({requests:[]});
        const out:any=await db.prepare(`SELECT sr.id,sr.title,sr.description,sr.address,sr.status,sr.created_at,sr.updated_at,sr.scheduled_at,cu.full_name AS client_name,CASE WHEN cu.whatsapp_public=1 THEN cu.phone ELSE NULL END AS client_phone,cu.city AS client_city,sc.name AS category,q.id AS quote_id,q.price AS quote_price,q.message AS quote_message,q.status AS quote_status FROM service_requests sr JOIN users cu ON cu.id=sr.client_id LEFT JOIN service_categories sc ON sc.id=sr.category_id LEFT JOIN quotes q ON q.request_id=sr.id AND q.provider_id=? WHERE sr.target_provider_id=? ORDER BY sr.created_at DESC LIMIT 100`).bind(provider.id,provider.id).all(); return json({requests:out.results||[]});
      }

      const quoteRequestMatch=url.pathname.match(/^\/api\/service-requests\/(\d+)\/quote$/);
      if(quoteRequestMatch&&request.method==='POST'){
        const user:any=await sessionUser(request,db); if(!user||user.role!=='provider')return json({error:'Acesso exclusivo do prestador.'},{status:403}); const provider:any=await providerForUser(db,user.id); if(!provider)return json({error:'Perfil profissional não encontrado.'},{status:404});
        const requestId=Number(quoteRequestMatch[1]); const reqRow:any=await db.prepare('SELECT id,status,target_provider_id FROM service_requests WHERE id=?').bind(requestId).first(); if(!reqRow||Number(reqRow.target_provider_id)!==Number(provider.id))return json({error:'Solicitação não encontrada.'},{status:404}); if(!['open','quoted'].includes(reqRow.status))return json({error:'Esta solicitação não aceita novo orçamento neste status.'},{status:409});
        const b=await readBody(request); const price=money(b.price); const message=String(b.message||'').trim(); if(price==null||price<=0)return json({error:'Informe um valor de orçamento válido.'},{status:400});
        await db.prepare(`INSERT INTO quotes(request_id,provider_id,price,message,status,created_at,updated_at) VALUES(?,?,?,?,'pending',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(request_id,provider_id) DO UPDATE SET price=excluded.price,message=excluded.message,status='pending',updated_at=CURRENT_TIMESTAMP`).bind(requestId,provider.id,price,message).run();
        await db.prepare(`UPDATE service_requests SET status='quoted',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(requestId).run(); const client:any=await db.prepare('SELECT client_id,title FROM service_requests WHERE id=?').bind(requestId).first(); if(client)await notify(db,Number(client.client_id),'Novo orçamento recebido',`Você recebeu um orçamento de ${user.full_name} para ${client.title}.`,'quote',requestId); return json({ok:true});
      }

      const quoteDecisionMatch=url.pathname.match(/^\/api\/quotes\/(\d+)\/decision$/);
      if(quoteDecisionMatch&&request.method==='POST'){
        const user:any=await sessionUser(request,db); if(!user||user.role!=='client')return json({error:'Acesso exclusivo do cliente.'},{status:403}); const quoteId=Number(quoteDecisionMatch[1]); const b=await readBody(request); const decision=String(b.decision||''); if(!['accepted','rejected'].includes(decision))return json({error:'Decisão inválida.'},{status:400});
        const q:any=await db.prepare(`SELECT q.id,q.request_id,q.provider_id,q.status,sr.client_id,sr.status AS request_status FROM quotes q JOIN service_requests sr ON sr.id=q.request_id WHERE q.id=?`).bind(quoteId).first(); if(!q||Number(q.client_id)!==Number(user.id))return json({error:'Orçamento não encontrado.'},{status:404}); if(!['pending','accepted'].includes(q.status))return json({error:'Este orçamento já foi finalizado.'},{status:409});
        if(decision==='accepted'){
          await db.batch([db.prepare(`UPDATE quotes SET status='accepted',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(quoteId),db.prepare(`UPDATE service_requests SET status='accepted',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(q.request_id),db.prepare(`INSERT OR IGNORE INTO service_chats(request_id,status,created_at,updated_at) VALUES(?,'open',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).bind(q.request_id)]);
        } else {
          await db.batch([db.prepare(`UPDATE quotes SET status='rejected',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(quoteId),db.prepare(`UPDATE service_requests SET status='open',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(q.request_id)]);
        }
        const owner:any=await db.prepare('SELECT user_id FROM provider_profiles WHERE id=?').bind(q.provider_id).first(); if(owner?.user_id)await notify(db,Number(owner.user_id),decision==='accepted'?'Orçamento aceito':'Orçamento recusado',decision==='accepted'?`${user.full_name} aceitou seu orçamento. O chat foi liberado.`:`${user.full_name} recusou seu orçamento.`,'quote',Number(q.request_id)); return json({ok:true,status:decision});
      }

      const reqStatusMatch=url.pathname.match(/^\/api\/service-requests\/(\d+)\/status$/);
      if(reqStatusMatch&&request.method==='POST'){
        const user:any=await sessionUser(request,db); if(!user)return json({error:'Sessão inválida.'},{status:401}); const requestId=Number(reqStatusMatch[1]); const b=await readBody(request); const action=String(b.action||''); const reqRow:any=await db.prepare('SELECT * FROM service_requests WHERE id=?').bind(requestId).first(); if(!reqRow)return json({error:'Solicitação não encontrada.'},{status:404});
        if(user.role==='provider'){
          const provider:any=await providerForUser(db,user.id); if(!provider||Number(reqRow.target_provider_id)!==Number(provider.id))return json({error:'Sem permissão.'},{status:403});
          const allowed:Record<string,{from:string[],to:string}>={start:{from:['accepted'],to:'in_progress'},complete:{from:['in_progress','accepted'],to:'completed'},cancel:{from:['open','quoted','accepted'],to:'cancelled'}}; const rule=allowed[action]; if(!rule||!rule.from.includes(reqRow.status))return json({error:'Ação não permitida para o status atual.'},{status:409});
          await db.prepare('UPDATE service_requests SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(rule.to,requestId).run(); const title=String(reqRow.title||'serviço'); await notify(db,Number(reqRow.client_id),rule.to==='in_progress'?'Serviço iniciado':rule.to==='completed'?'Serviço concluído':'Atualização do serviço',rule.to==='completed'?`${user.full_name} marcou ${title} como concluído. Você já pode avaliar.`:`Status de ${title}: ${rule.to}.`,'request',requestId); return json({ok:true,status:rule.to});
        }
        if(Number(reqRow.client_id)!==Number(user.id))return json({error:'Sem permissão.'},{status:403}); if(action!=='cancel'||!['open','quoted'].includes(reqRow.status))return json({error:'Esta solicitação não pode mais ser cancelada pelo cliente.'},{status:409}); await db.prepare(`UPDATE service_requests SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(requestId).run(); return json({ok:true,status:'cancelled'});
      }

      if(url.pathname==='/api/reviews'&&request.method==='POST'){
        const user:any=await sessionUser(request,db); if(!user||user.role!=='client')return json({error:'Somente clientes podem avaliar.'},{status:403}); const b=await readBody(request); const requestId=Number(b.requestId||0); const rating=Number(b.rating||0); const comment=String(b.comment||'').trim(); if(!requestId||rating<1||rating>5)return json({error:'Informe uma nota entre 1 e 5.'},{status:400});
        const reqRow:any=await db.prepare(`SELECT sr.id,sr.client_id,sr.target_provider_id,sr.status,q.status AS quote_status FROM service_requests sr LEFT JOIN quotes q ON q.request_id=sr.id AND q.provider_id=sr.target_provider_id WHERE sr.id=?`).bind(requestId).first(); if(!reqRow||Number(reqRow.client_id)!==Number(user.id))return json({error:'Serviço não encontrado.'},{status:404}); if(reqRow.status!=='completed'||reqRow.quote_status!=='accepted')return json({error:'A avaliação só é liberada após um serviço concluído.'},{status:409});
        try { await db.prepare(`INSERT INTO reviews(request_id,client_id,provider_id,rating,comment,created_at) VALUES(?,?,?,?,?,CURRENT_TIMESTAMP)`).bind(requestId,user.id,reqRow.target_provider_id,rating,comment).run(); } catch(e:any){ if(String(e?.message||e).toLowerCase().includes('unique'))return json({error:'Você já avaliou este serviço.'},{status:409}); throw e; }
        await refreshProviderRating(db,Number(reqRow.target_provider_id)); const owner:any=await db.prepare('SELECT user_id FROM provider_profiles WHERE id=?').bind(reqRow.target_provider_id).first(); if(owner?.user_id)await notify(db,Number(owner.user_id),'Nova avaliação recebida',`${user.full_name} avaliou seu serviço com ${rating} estrela${rating>1?'s':''}.`,'review',requestId); return json({ok:true},{status:201});
      }

      if(url.pathname==='/api/favorites'&&request.method==='GET'){
        const user:any=await sessionUser(request,db); if(!user||user.role!=='client')return json({error:'Acesso exclusivo do cliente.'},{status:403}); const out:any=await db.prepare(`SELECT f.provider_id AS id,COALESCE(pp.professional_name,pu.full_name) AS name,COALESCE(sc.name,ps.title,'Serviços') AS category,pp.average_rating AS rating,pp.total_reviews AS review_count,pp.latitude,pp.longitude,pp.available,pp.verified,pp.description,pu.profile_image AS image FROM favorites f JOIN provider_profiles pp ON pp.id=f.provider_id JOIN users pu ON pu.id=pp.user_id LEFT JOIN provider_services ps ON ps.provider_id=pp.id AND ps.active=1 LEFT JOIN service_categories sc ON sc.id=ps.category_id WHERE f.client_id=? GROUP BY f.provider_id ORDER BY f.created_at DESC`).bind(user.id).all(); return json({favorites:out.results||[]});
      }
      if(url.pathname==='/api/favorites'&&request.method==='POST'){
        const user:any=await sessionUser(request,db); if(!user||user.role!=='client')return json({error:'Acesso exclusivo do cliente.'},{status:403}); const b=await readBody(request); const providerId=Number(b.providerId||0); if(!providerId)return json({error:'Profissional inválido.'},{status:400}); await db.prepare('INSERT OR IGNORE INTO favorites(client_id,provider_id,created_at) VALUES(?,?,CURRENT_TIMESTAMP)').bind(user.id,providerId).run(); return json({ok:true},{status:201});
      }
      const favMatch=url.pathname.match(/^\/api\/favorites\/(\d+)$/);
      if(favMatch&&request.method==='DELETE'){
        const user:any=await sessionUser(request,db); if(!user||user.role!=='client')return json({error:'Acesso exclusivo do cliente.'},{status:403}); await db.prepare('DELETE FROM favorites WHERE client_id=? AND provider_id=?').bind(user.id,Number(favMatch[1])).run(); return json({ok:true});
      }


      // Central de notificações
      if(url.pathname==='/api/notifications'&&request.method==='GET'){
        const user:any=await sessionUser(request,db); if(!user)return json({error:'Sessão inválida.'},{status:401}); const out:any=await db.prepare(`SELECT id,title,message,kind,read_at,created_at,link_request_id FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 60`).bind(user.id).all(); return json({notifications:out.results||[]});
      }
      if(url.pathname==='/api/notifications/read'&&request.method==='POST'){
        const user:any=await sessionUser(request,db); if(!user)return json({error:'Sessão inválida.'},{status:401}); const b=await readBody(request); if(b.all)await db.prepare('UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE user_id=? AND read_at IS NULL').bind(user.id).run(); else await db.prepare('UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?').bind(Number(b.id||0),user.id).run(); return json({ok:true});
      }

      // Agenda de serviços aceitos
      const scheduleMatch=url.pathname.match(/^\/api\/service-requests\/(\d+)\/schedule$/);
      if(scheduleMatch&&request.method==='POST'){
        const user:any=await sessionUser(request,db); if(!user)return json({error:'Sessão inválida.'},{status:401}); const requestId=Number(scheduleMatch[1]); const b=await readBody(request); const dt=new Date(String(b.scheduledAt||'')); if(Number.isNaN(dt.getTime()))return json({error:'Informe uma data e horário válidos.'},{status:400}); const row:any=await db.prepare('SELECT id,client_id,target_provider_id,status,title FROM service_requests WHERE id=?').bind(requestId).first(); if(!row||!['accepted','in_progress'].includes(row.status))return json({error:'O serviço precisa estar aceito para ser agendado.'},{status:409}); const provider:any=user.role==='provider'?await providerForUser(db,user.id):null; const allowed=Number(row.client_id)===Number(user.id)||(provider&&Number(provider.id)===Number(row.target_provider_id)); if(!allowed)return json({error:'Sem permissão para agendar este serviço.'},{status:403}); await db.prepare('UPDATE service_requests SET scheduled_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(dt.toISOString(),requestId).run(); const providerOwner:any=await db.prepare('SELECT user_id FROM provider_profiles WHERE id=?').bind(row.target_provider_id).first(); const otherId=Number(user.id)===Number(row.client_id)?Number(providerOwner?.user_id||0):Number(row.client_id); if(otherId)await notify(db,otherId,'Atendimento agendado',`${row.title}: ${dt.toLocaleString('pt-BR')}`,'schedule',requestId); return json({ok:true,scheduledAt:dt.toISOString()});
      }

      // Portfólio profissional
      if(url.pathname==='/api/provider/portfolio'&&request.method==='GET'){
        const user:any=await sessionUser(request,db); if(!user||user.role!=='provider')return json({error:'Acesso exclusivo do prestador.'},{status:403}); const provider:any=await providerForUser(db,user.id); const out:any=await db.prepare(`SELECT id,file_url,caption,created_at FROM provider_portfolio WHERE provider_id=? AND file_type='image' ORDER BY created_at DESC LIMIT 30`).bind(provider?.id||0).all(); return json({items:out.results||[]});
      }
      if(url.pathname==='/api/provider/portfolio'&&request.method==='POST'){
        const user:any=await sessionUser(request,db); if(!user||user.role!=='provider')return json({error:'Acesso exclusivo do prestador.'},{status:403}); const provider:any=await providerForUser(db,user.id); const b=await readBody(request); const image=String(b.image||''); if(!/^data:image\/(jpeg|png|webp);base64,/i.test(image)||image.length>520000)return json({error:'Imagem inválida ou muito grande.'},{status:400}); const caption=String(b.caption||'').trim().slice(0,180); const r:any=await db.prepare(`INSERT INTO provider_portfolio(provider_id,file_url,file_type,caption,created_at) VALUES(?,?,'image',?,CURRENT_TIMESTAMP)`).bind(provider.id,image,caption).run(); return json({ok:true,id:r.meta?.last_row_id},{status:201});
      }
      const portfolioDelete=url.pathname.match(/^\/api\/provider\/portfolio\/(\d+)$/);
      if(portfolioDelete&&request.method==='DELETE'){
        const user:any=await sessionUser(request,db); if(!user||user.role!=='provider')return json({error:'Acesso exclusivo do prestador.'},{status:403}); const provider:any=await providerForUser(db,user.id); await db.prepare('DELETE FROM provider_portfolio WHERE id=? AND provider_id=?').bind(Number(portfolioDelete[1]),provider?.id||0).run(); return json({ok:true});
      }

      // Imagem de perfil opcional (armazenada como Data URL comprimida pelo navegador).
      if(url.pathname==='/api/profile/image'&&request.method==='PUT'){
        const user:any=await sessionUser(request,db); if(!user)return json({error:'Sessão inválida ou expirada.'},{status:401});
        const b=await readBody(request); const image=String(b.image||'');
        if(!/^data:image\/(jpeg|png|webp);base64,/i.test(image))return json({error:'Envie uma imagem JPG, PNG ou WebP válida.'},{status:400});
        if(image.length>520000)return json({error:'A imagem ficou muito grande. Use uma foto menor.'},{status:413});
        await db.prepare('UPDATE users SET profile_image=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(image,user.id).run();
        return json({ok:true,image});
      }
      if(url.pathname==='/api/profile/image'&&request.method==='DELETE'){
        const user:any=await sessionUser(request,db); if(!user)return json({error:'Sessão inválida ou expirada.'},{status:401});
        await db.prepare('UPDATE users SET profile_image=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(user.id).run(); return json({ok:true});
      }

      // Chat do serviço. Só existe depois que o cliente aceita o orçamento.
      const chatMatch=url.pathname.match(/^\/api\/service-requests\/(\d+)\/chat$/);
      if(chatMatch&&request.method==='GET'){
        const user:any=await sessionUser(request,db); if(!user)return json({error:'Sessão inválida ou expirada.'},{status:401}); const requestId=Number(chatMatch[1]);
        const row:any=await db.prepare(`SELECT sr.id,sr.client_id,sr.target_provider_id,sr.status,cu.full_name AS client_name,pu.full_name AS provider_name,q.status AS quote_status FROM service_requests sr JOIN users cu ON cu.id=sr.client_id JOIN provider_profiles pp ON pp.id=sr.target_provider_id JOIN users pu ON pu.id=pp.user_id LEFT JOIN quotes q ON q.request_id=sr.id AND q.provider_id=sr.target_provider_id WHERE sr.id=?`).bind(requestId).first();
        if(!row)return json({error:'Solicitação não encontrada.'},{status:404}); const provider:any=user.role==='provider'?await providerForUser(db,user.id):null; const participant=Number(row.client_id)===Number(user.id)||(provider&&Number(row.target_provider_id)===Number(provider.id)); if(!participant)return json({error:'Sem permissão para este chat.'},{status:403});
        if(row.quote_status!=='accepted'||!['accepted','in_progress','completed'].includes(row.status))return json({error:'O chat é liberado somente após o orçamento ser aceito.'},{status:409});
        await db.prepare(`INSERT OR IGNORE INTO service_chats(request_id,status,created_at,updated_at) VALUES(?,'open',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).bind(requestId).run(); const chat:any=await db.prepare('SELECT * FROM service_chats WHERE request_id=?').bind(requestId).first();
        const messages:any=await db.prepare(`SELECT cm.id,cm.sender_user_id,cm.message_type,cm.message,cm.latitude,cm.longitude,cm.created_at,u.full_name AS sender_name FROM chat_messages cm JOIN users u ON u.id=cm.sender_user_id WHERE cm.chat_id=? ORDER BY cm.id ASC LIMIT 500`).bind(chat.id).all();
        return json({currentUserId:user.id,chat:{id:chat.id,status:chat.status,requestId,clientName:row.client_name,providerName:row.provider_name,requestStatus:row.status},messages:messages.results||[]});
      }
      if(chatMatch&&request.method==='POST'){
        const user:any=await sessionUser(request,db); if(!user)return json({error:'Sessão inválida ou expirada.'},{status:401}); const requestId=Number(chatMatch[1]); const b=await readBody(request);
        const row:any=await db.prepare(`SELECT sr.id,sr.client_id,sr.target_provider_id,sr.status,q.status AS quote_status FROM service_requests sr LEFT JOIN quotes q ON q.request_id=sr.id AND q.provider_id=sr.target_provider_id WHERE sr.id=?`).bind(requestId).first(); if(!row)return json({error:'Solicitação não encontrada.'},{status:404}); const provider:any=user.role==='provider'?await providerForUser(db,user.id):null; const participant=Number(row.client_id)===Number(user.id)||(provider&&Number(row.target_provider_id)===Number(provider.id)); if(!participant)return json({error:'Sem permissão para este chat.'},{status:403}); if(row.quote_status!=='accepted'||!['accepted','in_progress','completed'].includes(row.status))return json({error:'O chat ainda não está disponível.'},{status:409});
        await db.prepare(`INSERT OR IGNORE INTO service_chats(request_id,status,created_at,updated_at) VALUES(?,'open',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).bind(requestId).run(); const chat:any=await db.prepare('SELECT * FROM service_chats WHERE request_id=?').bind(requestId).first(); if(chat.status!=='open')return json({error:'Este chat foi encerrado pelo cliente.'},{status:409});
        const type=String(b.type||'text'); if(!['text','location'].includes(type))return json({error:'Tipo de mensagem inválido.'},{status:400}); let message=String(b.message||'').trim().slice(0,2000); let lat=null,lng=null;
        if(type==='text'&&!message)return json({error:'Digite uma mensagem.'},{status:400}); if(type==='location'){lat=Number(b.latitude);lng=Number(b.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lng))return json({error:'Localização inválida.'},{status:400});message=message||'Localização compartilhada pelo cliente.';}
        const result:any=await db.prepare(`INSERT INTO chat_messages(chat_id,sender_user_id,message_type,message,latitude,longitude,created_at) VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP)`).bind(chat.id,user.id,type,message,lat,lng).run(); await db.prepare('UPDATE service_chats SET updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(chat.id).run(); const otherId=Number(row.client_id)===Number(user.id)?Number((await db.prepare('SELECT user_id FROM provider_profiles WHERE id=?').bind(row.target_provider_id).first() as any)?.user_id||0):Number(row.client_id); if(otherId)await notify(db,otherId,'Nova mensagem no chat',type==='location'?`${user.full_name} compartilhou uma localização.`:`${user.full_name}: ${message.slice(0,90)}`,'message',requestId); return json({ok:true,id:result.meta?.last_row_id||null},{status:201});
      }
      const chatCloseMatch=url.pathname.match(/^\/api\/service-requests\/(\d+)\/chat\/close$/);
      if(chatCloseMatch&&request.method==='POST'){
        const user:any=await sessionUser(request,db); if(!user||user.role!=='client')return json({error:'Somente o cliente pode encerrar o chat.'},{status:403}); const requestId=Number(chatCloseMatch[1]); const row:any=await db.prepare('SELECT id,client_id,status FROM service_requests WHERE id=?').bind(requestId).first(); if(!row||Number(row.client_id)!==Number(user.id))return json({error:'Solicitação não encontrada.'},{status:404}); if(!['accepted','in_progress','completed'].includes(row.status))return json({error:'Este chat ainda não pode ser encerrado.'},{status:409});
        await db.prepare(`UPDATE service_chats SET status='closed',closed_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE request_id=?`).bind(user.id,requestId).run(); return json({ok:true,status:'closed'});
      }

      // Presença online: clientes e prestadores atualizam o último acesso enquanto o painel estiver aberto.
      if(url.pathname==='/api/presence'&&request.method==='POST'){
        const user:any=await sessionUser(request,db); if(!user)return json({error:'Sessão inválida ou expirada.'},{status:401});
        await db.prepare('UPDATE users SET last_seen=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(user.id).run();
        return json({ok:true});
      }

      // Privacidade do WhatsApp para cliente e prestador.
      if(url.pathname==='/api/account/privacy'&&request.method==='PUT'){
        const user:any=await sessionUser(request,db); if(!user)return json({error:'Sessão inválida ou expirada.'},{status:401});
        const b=await readBody(request); const show=b.whatsappPublic===true||b.whatsappPublic===1||b.whatsappPublic==='1';
        await db.prepare('UPDATE users SET whatsapp_public=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(show?1:0,user.id).run();
        return json({ok:true,whatsappPublic:show});
      }

      // Estatísticas de clientes para o painel do prestador. Online = atividade nos últimos 2 minutos.
      if(url.pathname==='/api/provider/client-stats'&&request.method==='GET'){
        const user:any=await sessionUser(request,db); if(!user||user.role!=='provider')return json({error:'Acesso exclusivo do prestador.'},{status:403});
        const row:any=await db.prepare(`SELECT COUNT(*) AS total,SUM(CASE WHEN last_seen IS NOT NULL AND last_seen>=datetime('now','-2 minutes') THEN 1 ELSE 0 END) AS online FROM users WHERE role='client' AND active=1`).first();
        const total=Number(row?.total||0), online=Number(row?.online||0); return json({total,online,offline:Math.max(0,total-online)});
      }

      // Visibilidade do marcador do prestador no mapa.
      if(url.pathname==='/api/provider/map-visibility'&&request.method==='POST'){
        const user:any=await sessionUser(request,db); if(!user||user.role!=='provider')return json({error:'Acesso exclusivo do prestador.'},{status:403});
        const provider:any=await providerForUser(db,user.id); if(!provider)return json({error:'Perfil não encontrado.'},{status:404});
        const b=await readBody(request); const visible=b.visible===true||b.visible===1||b.visible==='1';
        await db.prepare('UPDATE provider_profiles SET map_visible=?,live_location_enabled=CASE WHEN ?=0 THEN 0 ELSE live_location_enabled END,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(visible?1:0,visible?1:0,provider.id).run();
        return json({ok:true,visible});
      }

      // Compartilhamento de localização em tempo real (near real-time) enquanto o navegador/app estiver ativo.
      if(url.pathname==='/api/provider/live-location'&&request.method==='POST'){
        const user:any=await sessionUser(request,db); if(!user||user.role!=='provider')return json({error:'Acesso exclusivo do prestador.'},{status:403});
        const provider:any=await providerForUser(db,user.id); if(!provider)return json({error:'Perfil não encontrado.'},{status:404});
        const b=await readBody(request); const action=String(b.action||'update');
        if(action==='stop'){ await db.prepare('UPDATE provider_profiles SET live_location_enabled=0,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(provider.id).run(); return json({ok:true,live:false}); }
        const latitude=Number(b.latitude), longitude=Number(b.longitude), accuracy=Number(b.accuracy||0);
        if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||latitude < -90||latitude > 90||longitude < -180||longitude > 180)return json({error:'Coordenadas de GPS inválidas.'},{status:400});
        if(accuracy&&(!Number.isFinite(accuracy)||accuracy<0||accuracy>100000))return json({error:'Precisão de localização inválida.'},{status:400});
        await db.prepare('UPDATE provider_profiles SET latitude=?,longitude=?,map_visible=1,live_location_enabled=1,live_location_updated_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(latitude,longitude,provider.id).run();
        return json({ok:true,live:true,latitude,longitude,accuracy:accuracy||null});
      }

      // Exclusão da própria conta: desativação segura (soft delete).
      if(url.pathname==='/api/account'&&request.method==='DELETE'){
        const user:any=await sessionUser(request,db); if(!user)return json({error:'Sessão inválida ou expirada.'},{status:401}); if(user.role==='admin')return json({error:'A conta administrativa deve ser gerenciada diretamente no banco para evitar bloqueio acidental.'},{status:403}); const b=await readBody(request); if(String(b.confirm||'').toUpperCase()!=='EXCLUIR')return json({error:'Confirmação inválida.'},{status:400});
        await db.prepare('UPDATE users SET active=0,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(user.id).run(); if(user.role==='provider')await db.prepare('UPDATE provider_profiles SET available=0,updated_at=CURRENT_TIMESTAMP WHERE user_id=?').bind(user.id).run(); await db.prepare('DELETE FROM sessions WHERE user_id=?').bind(user.id).run(); return json({ok:true});
      }

      // Painel de suporte/administração.
      if(url.pathname==='/api/admin/users'&&request.method==='GET'){
        const admin:any=await sessionUser(request,db); if(!admin||admin.role!=='admin')return json({error:'Acesso exclusivo do suporte.'},{status:403}); const out:any=await db.prepare(`SELECT u.id,u.full_name AS name,u.username,u.role,u.phone,u.city,u.active,u.created_at,pp.id AS provider_id,pp.available,pp.verified,pp.average_rating AS rating,pp.total_reviews AS review_count FROM users u LEFT JOIN provider_profiles pp ON pp.user_id=u.id ORDER BY u.created_at DESC,u.id DESC LIMIT 500`).all(); return json({users:out.results||[]});
      }
      const adminUserStatus=url.pathname.match(/^\/api\/admin\/users\/(\d+)\/status$/);
      if(adminUserStatus&&request.method==='POST'){
        const admin:any=await sessionUser(request,db); if(!admin||admin.role!=='admin')return json({error:'Acesso exclusivo do suporte.'},{status:403}); const userId=Number(adminUserStatus[1]); if(userId===Number(admin.id))return json({error:'Você não pode desativar sua própria conta administrativa.'},{status:409}); const b=await readBody(request); const active=b.active===true||b.active===1||b.active==='1'; const target:any=await db.prepare('SELECT id,role FROM users WHERE id=?').bind(userId).first(); if(!target)return json({error:'Conta não encontrada.'},{status:404}); await db.prepare('UPDATE users SET active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(active?1:0,userId).run(); if(target.role==='provider'&&!active)await db.prepare('UPDATE provider_profiles SET available=0,updated_at=CURRENT_TIMESTAMP WHERE user_id=?').bind(userId).run(); if(!active)await db.prepare('DELETE FROM sessions WHERE user_id=?').bind(userId).run(); return json({ok:true,active});
      }
      if(url.pathname==='/api/admin/reviews'&&request.method==='GET'){
        const admin:any=await sessionUser(request,db); if(!admin||admin.role!=='admin')return json({error:'Acesso exclusivo do suporte.'},{status:403}); const out:any=await db.prepare(`SELECT r.id,r.rating,r.comment,r.created_at,r.provider_id,cu.full_name AS client_name,COALESCE(pp.professional_name,pu.full_name) AS provider_name FROM reviews r JOIN users cu ON cu.id=r.client_id JOIN provider_profiles pp ON pp.id=r.provider_id JOIN users pu ON pu.id=pp.user_id ORDER BY r.created_at DESC LIMIT 500`).all(); return json({reviews:out.results||[]});
      }
      const adminReviewDelete=url.pathname.match(/^\/api\/admin\/reviews\/(\d+)$/);
      if(adminReviewDelete&&request.method==='DELETE'){
        const admin:any=await sessionUser(request,db); if(!admin||admin.role!=='admin')return json({error:'Acesso exclusivo do suporte.'},{status:403}); const reviewId=Number(adminReviewDelete[1]); const review:any=await db.prepare('SELECT id,provider_id FROM reviews WHERE id=?').bind(reviewId).first(); if(!review)return json({error:'Avaliação não encontrada.'},{status:404}); await db.prepare('DELETE FROM reviews WHERE id=?').bind(reviewId).run(); await refreshProviderRating(db,Number(review.provider_id)); return json({ok:true});
      }
      const adminVerified=url.pathname.match(/^\/api\/admin\/providers\/(\d+)\/verified$/);
      if(adminVerified&&request.method==='POST'){
        const admin:any=await sessionUser(request,db); if(!admin||admin.role!=='admin')return json({error:'Acesso exclusivo do suporte.'},{status:403}); const b=await readBody(request); const verified=b.verified===true||b.verified===1||b.verified==='1'; await db.prepare('UPDATE provider_profiles SET verified=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(verified?1:0,Number(adminVerified[1])).run(); return json({ok:true,verified});
      }

      if(url.pathname==='/api/provider/location'&&request.method==='POST'){
        const user:any=await sessionUser(request,db); if(!user||user.role!=='provider')return json({error:'Acesso exclusivo do prestador.'},{status:403});
        const provider:any=await providerForUser(db,user.id); if(!provider)return json({error:'Perfil não encontrado.'},{status:404});
        const b=await readBody(request); const latitude=Number(b.latitude); const longitude=Number(b.longitude); const accuracy=Number(b.accuracy||0);
        if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||latitude < -90||latitude > 90||longitude < -180||longitude > 180)return json({error:'Coordenadas de GPS inválidas.'},{status:400});
        if(accuracy && (!Number.isFinite(accuracy)||accuracy<0||accuracy>100000))return json({error:'Precisão de localização inválida.'},{status:400});
        await db.prepare('UPDATE provider_profiles SET latitude=?,longitude=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(latitude,longitude,provider.id).run();
        return json({ok:true,latitude,longitude,accuracy:accuracy||null,message:'Localização do mapa atualizada pelo GPS.'});
      }

      if(url.pathname==='/api/provider/profile'&&request.method==='PUT'){
        const user:any=await sessionUser(request,db); if(!user||user.role!=='provider')return json({error:'Acesso exclusivo do prestador.'},{status:403}); const provider:any=await providerForUser(db,user.id); if(!provider)return json({error:'Perfil não encontrado.'},{status:404}); const b=await readBody(request);
        const name=String(b.professionalName||provider.professional_name||user.full_name).trim(); const description=String(b.description??provider.description??'').trim().slice(0,1200); const available=b.availabilityStatus?String(b.availabilityStatus)==='available':(b.available===true||b.available==='1'||b.available===1); const exact=b.exactLocationPublic===true||b.exactLocationPublic==='1'||b.exactLocationPublic===1;
        await db.prepare('UPDATE provider_profiles SET professional_name=?,description=?,available=?,exact_location_public=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(name,description,available?1:0,exact?1:0,provider.id).run(); return json({ok:true});
      }

      if(url.pathname==='/api/provider/services'&&request.method==='POST'){
        const user:any=await sessionUser(request,db); if(!user||user.role!=='provider')return json({error:'Acesso exclusivo do prestador.'},{status:403}); const provider:any=await providerForUser(db,user.id); if(!provider)return json({error:'Perfil não encontrado.'},{status:404}); const b=await readBody(request); const title=String(b.title||'').trim(); if(title.length<2)return json({error:'Informe o nome do serviço.'},{status:400}); const categoryName=String(b.category||title).trim(); const slug=slugify(categoryName); await db.prepare('INSERT OR IGNORE INTO service_categories(name,slug,active,created_at) VALUES(?,?,1,CURRENT_TIMESTAMP)').bind(categoryName,slug).run(); const cat:any=await db.prepare('SELECT id FROM service_categories WHERE slug=?').bind(slug).first(); const price=money(b.priceFrom); const r:any=await db.prepare('INSERT INTO provider_services(provider_id,category_id,title,description,price_from,active,created_at,updated_at) VALUES(?,?,?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)').bind(provider.id,cat.id,title,String(b.description||'').trim(),price).run(); return json({ok:true,id:r.meta?.last_row_id},{status:201});
      }
      const serviceMatch=url.pathname.match(/^\/api\/provider\/services\/(\d+)$/);
      if(serviceMatch&&request.method==='DELETE'){
        const user:any=await sessionUser(request,db); if(!user||user.role!=='provider')return json({error:'Acesso exclusivo do prestador.'},{status:403}); const provider:any=await providerForUser(db,user.id); await db.prepare('DELETE FROM provider_services WHERE id=? AND provider_id=?').bind(Number(serviceMatch[1]),provider?.id||0).run(); return json({ok:true});
      }

      if(url.pathname.startsWith('/api/')) return json({error:'Rota não encontrada.'},{status:404});
      return env.ASSETS.fetch(request);
    } catch (e:any) {
      console.error('ServPerto API error', e);
      if (url.pathname.startsWith('/api/')) return json({ error: 'Erro interno do ServPerto.', detail: String(e?.message || e) }, { status: 500 });
      return new Response('Erro interno.', { status: 500 });
    }
  }
};

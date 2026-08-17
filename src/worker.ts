interface Env { DB?: D1Database; MEDIA?: R2Bucket; ASSETS: Fetcher; }
const enc=new TextEncoder();
function json(data:unknown,init:ResponseInit={}){const h=new Headers(init.headers);h.set('content-type','application/json; charset=UTF-8');return new Response(JSON.stringify(data),{...init,headers:h})}
async function readBody(req:Request){try{return await req.json() as Record<string,any>}catch{return {}}}
function makeRecoveryCode(){return String(crypto.getRandomValues(new Uint32Array(1))[0]%1_000_000).padStart(6,'0')}
function randomHex(bytes=16){const a=crypto.getRandomValues(new Uint8Array(bytes));return [...a].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function hashSecret(secret:string,salt:string){const key=await crypto.subtle.importKey('raw',enc.encode(secret),'PBKDF2',false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:enc.encode(salt),iterations:120000,hash:'SHA-256'},key,256);return [...new Uint8Array(bits)].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function verify(secret:string,salt:string,expected:string){return (await hashSecret(secret,salt))===expected}
function publicCoordinates(lat:number|null,lng:number|null,exact:boolean){if(lat==null||lng==null)return {lat:null,lng:null};if(exact)return {lat,lng};return {lat:Math.round(lat*100)/100,lng:Math.round(lng*100)/100}}
export default {async fetch(request:Request,env:Env):Promise<Response>{
 const url=new URL(request.url);
 if(url.pathname==='/api/health')return json({ok:true,app:'ServPerto',runtime:'Cloudflare Workers',database:Boolean(env.DB)});
 if(url.pathname.startsWith('/api/')&&!env.DB)return json({error:'Banco D1 ainda não vinculado. Adicione o binding DB ao Worker servperto.'},{status:503});
 const db=env.DB!;
 if(url.pathname==='/api/auth/register'&&request.method==='POST'){
  const b=await readBody(request);const role=b.role==='professional'?'professional':'client';
  const required=['name','phone','cep','city','address','username','password'];for(const f of required)if(!String(b[f]||'').trim())return json({error:`Campo obrigatório: ${f}`},{status:400});
  if(String(b.password).length<8)return json({error:'A senha precisa ter pelo menos 8 caracteres.'},{status:400});
  if(!/^[A-Za-z0-9._-]{4,40}$/.test(String(b.username)))return json({error:'Nome de login inválido. Use pelo menos 4 caracteres, sem espaços.'},{status:400});
  const exists=await db.prepare('SELECT id FROM users WHERE username=?').bind(String(b.username).toLowerCase()).first();if(exists)return json({error:'Este nome de login já está em uso.'},{status:409});
  const salt=randomHex(), recSalt=randomHex(), rec=makeRecoveryCode();const passHash=await hashSecret(String(b.password),salt),recHash=await hashSecret(rec,recSalt);
  const exact=b.showExactLocation==='1'||b.showExactLocation===true;const lat=Number.isFinite(Number(b.latitude))?Number(b.latitude):null,lng=Number.isFinite(Number(b.longitude))?Number(b.longitude):null;const pub=publicCoordinates(lat,lng,exact);
  try{
   const u=await db.prepare(`INSERT INTO users(name,phone,cep,city,address,username,password_hash,password_salt,recovery_hash,recovery_salt,role,latitude,longitude,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`).bind(String(b.name).trim(),String(b.phone).trim(),String(b.cep).trim(),String(b.city).trim(),String(b.address).trim(),String(b.username).toLowerCase(),passHash,salt,recHash,recSalt,role,lat,lng).run();
   if(role==='professional')await db.prepare(`INSERT INTO professionals(user_id,name,category,description,phone,city,address,latitude,longitude,exact_location,rating,review_count,plan,active) VALUES(?,?,?,?,?,?,?,?,?,?,0,0,'free',1)`).bind(u.meta.last_row_id,String(b.name).trim(),String(b.category||'Serviços').trim(),String(b.description||''),String(b.phone).trim(),String(b.city).trim(),String(b.address).trim(),pub.lat,pub.lng,exact?1:0).run();
   return json({ok:true,recoveryCode:rec},{status:201});
  }catch(e:any){return json({error:'Não foi possível criar o cadastro.',detail:String(e?.message||e)},{status:500})}
 }
 if(url.pathname==='/api/auth/login'&&request.method==='POST'){
  const b=await readBody(request);const u:any=await db.prepare('SELECT id,name,username,role,password_hash,password_salt FROM users WHERE username=?').bind(String(b.username||'').toLowerCase()).first();
  if(!u||!(await verify(String(b.password||''),u.password_salt,u.password_hash)))return json({error:'Login ou senha inválidos.'},{status:401});
  return json({ok:true,user:{id:u.id,name:u.name,username:u.username,role:u.role}});
 }
 if(url.pathname==='/api/auth/recover'&&request.method==='POST'){
  const b=await readBody(request);const username=String(b.username||'').toLowerCase();const u:any=await db.prepare('SELECT id,recovery_hash,recovery_salt,recovery_failed_attempts,recovery_locked_until FROM users WHERE username=?').bind(username).first();
  if(!u)return json({error:'Dados de recuperação inválidos.'},{status:400});
  if(u.recovery_locked_until&&Date.parse(u.recovery_locked_until)>Date.now())return json({error:'Muitas tentativas. Tente novamente mais tarde.'},{status:429});
  const ok=await verify(String(b.recoveryCode||''),u.recovery_salt,u.recovery_hash);if(!ok){const attempts=(u.recovery_failed_attempts||0)+1;const locked=attempts>=5?new Date(Date.now()+15*60*1000).toISOString():null;await db.prepare('UPDATE users SET recovery_failed_attempts=?, recovery_locked_until=? WHERE id=?').bind(attempts>=5?0:attempts,locked,u.id).run();return json({error:'Dados de recuperação inválidos.'},{status:400})}
  if(String(b.newPassword||'').length<8)return json({error:'A nova senha precisa ter pelo menos 8 caracteres.'},{status:400});
  const salt=randomHex(),hash=await hashSecret(String(b.newPassword),salt);await db.prepare('UPDATE users SET password_hash=?,password_salt=?,recovery_failed_attempts=0,recovery_locked_until=NULL WHERE id=?').bind(hash,salt,u.id).run();return json({ok:true});
 }
 if(url.pathname==='/api/professionals'&&request.method==='GET'){
  const {results}=await db.prepare(`SELECT id,name,category,description,phone,city,address,rating,review_count,latitude,longitude FROM professionals WHERE active=1 AND latitude IS NOT NULL AND longitude IS NOT NULL ORDER BY rating DESC,review_count DESC LIMIT 100`).all();return json(results);
 }
 if(url.pathname.startsWith('/api/'))return json({error:'Rota não encontrada'},{status:404});
 return env.ASSETS.fetch(request);
}};

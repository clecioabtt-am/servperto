interface Env { DB: D1Database; MEDIA: R2Bucket; }
export const onRequest: PagesFunction<Env> = async ({request,env}) => {
 const url=new URL(request.url); const path=url.pathname.replace('/api/','');
 if(path==='health') return Response.json({ok:true,app:'ServPerto'});
 if(path==='professionals' && request.method==='GET'){
  const {results}=await env.DB.prepare('SELECT id,name,category,rating,latitude,longitude FROM professionals WHERE active=1 ORDER BY rating DESC LIMIT 50').all();
  return Response.json(results);
 }
 return Response.json({error:'Rota não encontrada'},{status:404});
};

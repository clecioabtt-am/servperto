import React, { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

type Role = 'client' | 'professional';
type Professional = {
  id: number;
  name: string;
  category: string;
  description?: string;
  phone?: string;
  city?: string;
  address?: string;
  rating: number;
  review_count: number;
  latitude: number;
  longitude: number;
  distanceKm?: number;
};

declare global {
  interface Window { google?: any; }
}

const GOOGLE_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
const GOOGLE_MAP_ID = import.meta.env.VITE_GOOGLE_MAP_ID || 'DEMO_MAP_ID';

function distanceKm(aLat:number,aLng:number,bLat:number,bLng:number){
  const r=6371, toRad=(v:number)=>v*Math.PI/180;
  const dLat=toRad(bLat-aLat), dLng=toRad(bLng-aLng);
  const x=Math.sin(dLat/2)**2+Math.cos(toRad(aLat))*Math.cos(toRad(bLat))*Math.sin(dLng/2)**2;
  return r*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
}

async function api(path:string, options?:RequestInit){
  const res=await fetch(path,{...options,headers:{'content-type':'application/json',...(options?.headers||{})}});
  const data=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error||'Não foi possível concluir a operação.');
  return data;
}

function loadGoogleMaps(){
  if(!GOOGLE_KEY) return Promise.reject(new Error('Google Maps ainda não configurado.'));
  if(window.google?.maps) return Promise.resolve(window.google.maps);
  return new Promise<any>((resolve,reject)=>{
    const existing=document.querySelector<HTMLScriptElement>('script[data-servperto-google]');
    if(existing){ existing.addEventListener('load',()=>resolve(window.google.maps)); return; }
    const s=document.createElement('script');
    s.dataset.servpertoGoogle='1';
    s.async=true; s.defer=true;
    s.src=`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_KEY)}&loading=async&libraries=marker,places`;
    s.onload=()=>resolve(window.google.maps);
    s.onerror=()=>reject(new Error('Falha ao carregar o Google Maps.'));
    document.head.appendChild(s);
  });
}

function MapPanel({professionals,userPosition,onEnableLocation}:{professionals:Professional[],userPosition:{lat:number,lng:number}|null,onEnableLocation:()=>void}){
  const ref=useRef<HTMLDivElement>(null);
  const [mapError,setMapError]=useState('');
  useEffect(()=>{
    let cancelled=false;
    loadGoogleMaps().then(async()=>{
      if(cancelled||!ref.current) return;
      const center=userPosition||{lat:-3.1190,lng:-60.0217};
      const map=new window.google.maps.Map(ref.current,{center,zoom:userPosition?13:11,mapId:GOOGLE_MAP_ID,disableDefaultUI:true,zoomControl:true,gestureHandling:'greedy'});
      const {AdvancedMarkerElement,PinElement}=await window.google.maps.importLibrary('marker');
      const info=new window.google.maps.InfoWindow();
      professionals.filter(p=>Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)).forEach(p=>{
        const pin=new PinElement({background:'#087e94',borderColor:'#07586a',glyphColor:'#fff'});
        const marker=new AdvancedMarkerElement({map,position:{lat:p.latitude,lng:p.longitude},title:`${p.name} — ${p.category}`,content:pin.element});
        marker.addListener('click',()=>{
          const rating=p.review_count?`${p.rating.toFixed(1)} ⭐ (${p.review_count})`:'Novo profissional';
          info.setContent(`<div style="font-family:system-ui;min-width:190px"><b>${p.name}</b><br><span>${p.category}</span><br><small>${rating}${p.distanceKm!=null?` • ${p.distanceKm.toFixed(1)} km`:''}</small></div>`);
          info.open({map,anchor:marker});
        });
      });
      if(userPosition){
        const pin=new PinElement({background:'#e83e6e',borderColor:'#9f2144',glyphColor:'#fff',glyph:'●'});
        new AdvancedMarkerElement({map,position:userPosition,title:'Sua localização',content:pin.element});
      }
    }).catch(e=>setMapError(e.message));
    return()=>{cancelled=true};
  },[professionals,userPosition]);

  if(!GOOGLE_KEY) return <div className="mapFallback"><div>🗺️</div><b>Mapa Google pronto para conectar</b><span>Adicione a chave do Google Maps no Cloudflare.</span><button onClick={onEnableLocation}>📍 Usar minha localização</button></div>;
  return <div className="mapShell"><div ref={ref} className="googleMap"/>{mapError&&<div className="mapError">{mapError}</div>}<div className="mapBrand"><strong>ServPerto Mapa</strong><span>{professionals.length} profissionais encontrados</span></div><button className="locateBtn" onClick={onEnableLocation}>⌖ Minha localização</button></div>;
}

function RegisterModal({onClose}:{onClose:()=>void}){
  const [role,setRole]=useState<Role|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [recovery,setRecovery]=useState('');
  const [coords,setCoords]=useState<{lat:number,lng:number}|null>(null);

  async function geocode(address:string){
    if(!GOOGLE_KEY) return null;
    await loadGoogleMaps();
    const geocoder=new window.google.maps.Geocoder();
    const {results}=await geocoder.geocode({address});
    const loc=results?.[0]?.geometry?.location;
    return loc?{lat:loc.lat(),lng:loc.lng()}:null;
  }

  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault(); setBusy(true); setMessage('');
    const fd=new FormData(e.currentTarget);
    const payload:any=Object.fromEntries(fd.entries()); payload.role=role;
    try{
      const fullAddress=`${payload.address}, ${payload.cep}, ${payload.city}, Brasil`;
      const geo=coords||await geocode(fullAddress).catch(()=>null);
      if(geo){payload.latitude=geo.lat;payload.longitude=geo.lng;}
      const out=await api('/api/auth/register',{method:'POST',body:JSON.stringify(payload)});
      setRecovery(out.recoveryCode);
    }catch(err:any){setMessage(err.message)}finally{setBusy(false)}
  }

  if(recovery) return <div className="modalBackdrop"><div className="modal recoveryCard"><button className="close" onClick={onClose}>×</button><div className="successIcon">✓</div><h2>Cadastro criado</h2><p>Guarde este código em um local seguro. Ele será exibido apenas agora e poderá ser usado para redefinir sua senha.</p><div className="recoveryCode">{recovery}</div><p className="warning">Não compartilhe este código com outras pessoas.</p><button className="primary full" onClick={onClose}>Concluir</button></div></div>;
  return <div className="modalBackdrop"><div className="modal"><button className="close" onClick={onClose}>×</button>{!role?<><span className="eyebrow">CRIAR CONTA</span><h2>Como você quer usar o ServPerto?</h2><div className="roleGrid"><button onClick={()=>setRole('client')}><span>🙋</span><b>Sou cliente</b><small>Quero encontrar profissionais próximos.</small></button><button onClick={()=>setRole('professional')}><span>🧰</span><b>Sou prestador</b><small>Quero divulgar meus serviços.</small></button></div></>:<form onSubmit={submit}><button type="button" className="back" onClick={()=>setRole(null)}>← Alterar perfil</button><span className="eyebrow">{role==='professional'?'CADASTRO DO PRESTADOR':'CADASTRO DO CLIENTE'}</span><h2>Crie sua conta</h2><div className="formGrid"><label>Nome completo<input name="name" required/></label><label>Telefone<input name="phone" required placeholder="(92) 99999-9999"/></label><label>CEP<input name="cep" required inputMode="numeric"/></label><label>Cidade<input name="city" required defaultValue="Manaus"/></label><label className="wide">Endereço completo<input name="address" required placeholder="Rua, número, bairro"/></label>{role==='professional'&&<><label>Categoria principal<input name="category" required placeholder="Ex.: Eletricista"/></label><label>Local de atendimento<select name="locationType" defaultValue="work"><option value="work">Endereço de trabalho</option><option value="home">Endereço residencial</option></select></label><label className="wide consent"><input type="checkbox" name="showExactLocation" value="1"/> Exibir meu ponto exato no mapa público. Se desmarcado, o ServPerto poderá usar uma posição aproximada para proteger meu endereço residencial.</label></>}<label>Nome de login<input name="username" required minLength={4} autoCapitalize="none"/></label><label>Senha de acesso<input name="password" type="password" required minLength={8}/></label></div><button type="button" className="secondary full" onClick={()=>navigator.geolocation?.getCurrentPosition(p=>setCoords({lat:p.coords.latitude,lng:p.coords.longitude}),()=>setMessage('Não foi possível obter sua localização.'))}>📍 Usar localização atual para este cadastro</button>{coords&&<div className="okText">✓ Localização capturada.</div>}{message&&<div className="errorText">{message}</div>}<button disabled={busy} className="primary full">{busy?'Criando conta...':'Criar conta'}</button></form>}</div></div>;
}

function LoginModal({onClose}:{onClose:()=>void}){
  const [mode,setMode]=useState<'login'|'recover'>('login'); const [msg,setMsg]=useState('');
  async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();const f=Object.fromEntries(new FormData(e.currentTarget).entries());try{const out=await api(mode==='login'?'/api/auth/login':'/api/auth/recover',{method:'POST',body:JSON.stringify(f)});setMsg(mode==='login'?`Bem-vindo, ${out.user.name}!`:'Senha alterada com sucesso. Você já pode entrar.');}catch(err:any){setMsg(err.message)}}
  return <div className="modalBackdrop"><div className="modal compact"><button className="close" onClick={onClose}>×</button><span className="eyebrow">ACESSO SERVPERTO</span><h2>{mode==='login'?'Entrar na plataforma':'Recuperar acesso'}</h2><form onSubmit={submit}><label>Nome de login<input name="username" required/></label>{mode==='recover'&&<label>Código de recuperação (6 dígitos)<input name="recoveryCode" required inputMode="numeric" pattern="[0-9]{6}" maxLength={6}/></label>}<label>{mode==='login'?'Senha':'Nova senha'}<input name={mode==='login'?'password':'newPassword'} type="password" required minLength={8}/></label>{msg&&<div className={msg.startsWith('Bem-vindo')||msg.startsWith('Senha alterada')?'okText':'errorText'}>{msg}</div>}<button className="primary full">{mode==='login'?'Entrar':'Alterar senha'}</button><button type="button" className="linkBtn" onClick={()=>{setMode(mode==='login'?'recover':'login');setMsg('')}}>{mode==='login'?'Esqueci minha senha':'Voltar para o login'}</button></form></div></div>;
}

function App(){
  const [register,setRegister]=useState(false); const [login,setLogin]=useState(false); const [query,setQuery]=useState('');
  const [professionals,setProfessionals]=useState<Professional[]>([]); const [userPos,setUserPos]=useState<{lat:number,lng:number}|null>(null); const [geoMsg,setGeoMsg]=useState('');
  useEffect(()=>{api('/api/professionals').then(setProfessionals).catch(()=>setProfessionals([]))},[]);
  const shown=useMemo(()=>professionals.filter(p=>!query||`${p.name} ${p.category}`.toLowerCase().includes(query.toLowerCase())).map(p=>({...p,distanceKm:userPos?distanceKm(userPos.lat,userPos.lng,p.latitude,p.longitude):undefined})).sort((a,b)=>userPos?(a.distanceKm!-b.distanceKm!):(b.rating-a.rating)),[professionals,query,userPos]);
  function enableLocation(){setGeoMsg('');if(!navigator.geolocation){setGeoMsg('Este navegador não oferece geolocalização.');return}navigator.geolocation.getCurrentPosition(p=>setUserPos({lat:p.coords.latitude,lng:p.coords.longitude}),()=>setGeoMsg('Localização não autorizada. Você pode continuar pesquisando normalmente.'),{enableHighAccuracy:true,timeout:10000});}
  return <main><nav><b>📍 ServPerto</b><div className="navActions"><span>Manaus • AM</span><button className="navLogin" onClick={()=>setLogin(true)}>Entrar</button><button className="navRegister" onClick={()=>setRegister(true)}>Cadastre-se</button></div></nav><section className="hero"><div className="heroCopy"><small>PROFISSIONAIS PERTO DE VOCÊ</small><h1>O profissional certo,<br/><em>perto de você.</em></h1><p>Encontre prestadores de serviços próximos, confira avaliações e solicite orçamento em poucos minutos.</p><div className="search"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Qual serviço você precisa?"/><button onClick={enableLocation}>Buscar profissionais</button></div><div className="locationPrompt"><button onClick={enableLocation}>📍 Usar minha localização atual</button><span>{userPos?'Localização habilitada: resultados ordenados por distância.':'Funciona em celular, tablet e notebook quando o navegador autoriza a localização.'}</span></div>{geoMsg&&<div className="errorText">{geoMsg}</div>}<div className="providerCta"><div><b>Você presta serviços?</b><span>Crie seu perfil e seja encontrado por clientes próximos.</span></div><button onClick={()=>setRegister(true)}>Cadastrar gratuitamente</button></div></div><div className="card mapCard"><MapPanel professionals={shown} userPosition={userPos} onEnableLocation={enableLocation}/><div className="mapCaption"><h3>Profissionais próximos</h3><p>Localização + reputação para escolher com confiança.</p></div></div></section>{shown.length>0&&<section className="results"><div className="sectionTitle"><div><small>RESULTADOS NO MAPA</small><h2>{shown.length} profissional{shown.length!==1?'is':''} encontrado{shown.length!==1?'s':''}</h2></div>{userPos&&<span>📍 Ordenados por proximidade</span>}</div><div className="resultGrid">{shown.slice(0,6).map(p=><article key={p.id}><div className="avatar">{p.name.charAt(0)}</div><div><b>{p.name}</b><span>{p.category}</span><small>{p.review_count?`${p.rating.toFixed(1)} ⭐ • ${p.review_count} avaliações`:'Novo no ServPerto'}{p.distanceKm!=null?` • ${p.distanceKm.toFixed(1)} km`:''}</small></div></article>)}</div></section>}<section className="features"><article>⭐<h3>Avaliações reais</h3><p>Reputação construída por clientes.</p></article><article>📌<h3>Busca por proximidade</h3><p>Encontre quem atende perto de você.</p></article><article>💬<h3>Orçamento rápido</h3><p>Descreva o serviço e receba propostas.</p></article></section>{register&&<RegisterModal onClose={()=>setRegister(false)}/>} {login&&<LoginModal onClose={()=>setLogin(false)}/>}</main>}
createRoot(document.getElementById('root')!).render(<App/>);

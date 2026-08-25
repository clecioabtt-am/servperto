import React, { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
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

function distanceKm(aLat:number,aLng:number,bLat:number,bLng:number){
  const r=6371, toRad=(v:number)=>v*Math.PI/180;
  const dLat=toRad(bLat-aLat), dLng=toRad(bLng-aLng);
  const x=Math.sin(dLat/2)**2+Math.cos(toRad(aLat))*Math.cos(toRad(bLat))*Math.sin(dLng/2)**2;
  return r*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
}

async function api(path:string, options?:RequestInit){
  const res=await fetch(path,{...options,headers:{'content-type':'application/json',...(options?.headers||{})}});
  const data=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.detail||data.error||'Não foi possível concluir a operação.');
  return data;
}

function pinIcon(kind:'provider'|'user',label?:string){
  const cls=kind==='user'?'map-pin user-pin':'map-pin provider-pin';
  return L.divIcon({
    className:'servperto-div-icon',
    html:`<div class="${cls}" aria-label="${label||''}"><span>${kind==='user'?'●':'🧰'}</span></div>`,
    iconSize:[40,48], iconAnchor:[20,46], popupAnchor:[0,-42]
  });
}

function MapPanel({professionals,userPosition,onEnableLocation}:{professionals:Professional[],userPosition:{lat:number,lng:number}|null,onEnableLocation:()=>void}){
  const ref=useRef<HTMLDivElement>(null);
  const mapRef=useRef<L.Map|null>(null);
  const layerRef=useRef<L.LayerGroup|null>(null);

  useEffect(()=>{
    if(!ref.current || mapRef.current) return;
    const map=L.map(ref.current,{zoomControl:false,attributionControl:true,minZoom:3}).setView([-3.1190,-60.0217],11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
      maxZoom:19,
      attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors'
    }).addTo(map);
    L.control.zoom({position:'bottomright'}).addTo(map);
    layerRef.current=L.layerGroup().addTo(map);
    mapRef.current=map;
    setTimeout(()=>map.invalidateSize(),50);
    return()=>{map.remove();mapRef.current=null;layerRef.current=null};
  },[]);

  useEffect(()=>{
    const map=mapRef.current, layer=layerRef.current;
    if(!map||!layer) return;
    layer.clearLayers();
    const bounds:L.LatLngExpression[]=[];
    professionals.filter(p=>Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)).forEach(p=>{
      const pos:L.LatLngExpression=[p.latitude,p.longitude]; bounds.push(pos);
      const rating=p.review_count?`${Number(p.rating||0).toFixed(1)} ⭐ (${p.review_count})`:'Novo profissional';
      const distance=p.distanceKm!=null?` • ${p.distanceKm.toFixed(1)} km`:'';
      L.marker(pos,{icon:pinIcon('provider',p.name)}).bindPopup(
        `<div class="servperto-popup"><strong>${escapeHtml(p.name)}</strong><span>${escapeHtml(p.category)}</span><small>${escapeHtml(rating+distance)}</small></div>`
      ).addTo(layer);
    });
    if(userPosition){
      const pos:L.LatLngExpression=[userPosition.lat,userPosition.lng]; bounds.push(pos);
      L.marker(pos,{icon:pinIcon('user','Sua localização'),zIndexOffset:1000}).bindPopup('<b>Sua localização atual</b>').addTo(layer);
      map.setView(pos,13,{animate:true});
    } else if(bounds.length===1) map.setView(bounds[0],13);
    else if(bounds.length>1) map.fitBounds(L.latLngBounds(bounds),{padding:[35,35],maxZoom:14});
    else map.setView([-3.1190,-60.0217],11);
  },[professionals,userPosition]);

  return <div className="mapShell"><div ref={ref} className="leafletMap"/><div className="mapBrand"><strong>ServPerto Mapa</strong><span>OpenStreetMap • sem mensalidade</span></div><button className="locateBtn" onClick={onEnableLocation}>⌖ Minha localização</button></div>;
}

function escapeHtml(v:string){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]||c))}

function RegisterModal({onClose}:{onClose:()=>void}){
  const [role,setRole]=useState<Role|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [recovery,setRecovery]=useState('');
  const [coords,setCoords]=useState<{lat:number,lng:number}|null>(null);

  async function geocode(address:string){
    const out=await api(`/api/geocode?q=${encodeURIComponent(address)}`);
    if(out?.latitude!=null&&out?.longitude!=null) return {lat:Number(out.latitude),lng:Number(out.longitude)};
    return null;
  }

  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault(); setBusy(true); setMessage('');
    const fd=new FormData(e.currentTarget);
    const payload:any=Object.fromEntries(fd.entries()); payload.role=role;
    try{
      if(role==='professional'){
        const fullAddress=`${payload.address}, ${payload.cep}, ${payload.city}, AM, Brasil`;
        const geo=coords||await geocode(fullAddress).catch(()=>null);
        if(!geo){
          setMessage('Não conseguimos localizar esse endereço no mapa. Use “localização atual” ou confira endereço/CEP.');
          setBusy(false); return;
        }
        payload.latitude=geo.lat; payload.longitude=geo.lng;
      } else if(coords){ payload.latitude=coords.lat; payload.longitude=coords.lng; }
      const out=await api('/api/auth/register',{method:'POST',body:JSON.stringify(payload)});
      setRecovery(out.recoveryCode);
    }catch(err:any){setMessage(err.message)}finally{setBusy(false)}
  }

  if(recovery) return <div className="modalBackdrop"><div className="modal recoveryCard"><button className="close" onClick={onClose}>×</button><div className="successIcon">✓</div><h2>Cadastro criado</h2><p>Guarde este código em um local seguro. Ele será exibido apenas agora e poderá ser usado para redefinir sua senha.</p><div className="recoveryCode">{recovery}</div><p className="warning">Não compartilhe este código com outras pessoas.</p><button className="primary full" onClick={onClose}>Concluir</button></div></div>;
  return <div className="modalBackdrop"><div className="modal"><button className="close" onClick={onClose}>×</button>{!role?<><span className="eyebrow">CRIAR CONTA</span><h2>Como você quer usar o ServPerto?</h2><div className="roleGrid"><button onClick={()=>setRole('client')}><span>🙋</span><b>Sou cliente</b><small>Quero encontrar profissionais próximos.</small></button><button onClick={()=>setRole('professional')}><span>🧰</span><b>Sou prestador</b><small>Quero divulgar meus serviços.</small></button></div></>:<form onSubmit={submit}><button type="button" className="back" onClick={()=>setRole(null)}>← Alterar perfil</button><span className="eyebrow">{role==='professional'?'CADASTRO DO PRESTADOR':'CADASTRO DO CLIENTE'}</span><h2>Crie sua conta</h2><div className="formGrid"><label>Nome completo<input name="name" required/></label><label>Telefone<input name="phone" required placeholder="(92) 99999-9999"/></label><label>CEP<input name="cep" required inputMode="numeric"/></label><label>Cidade<input name="city" required defaultValue="Manaus"/></label><label className="wide">Endereço completo<input name="address" required placeholder="Rua, número, bairro"/></label>{role==='professional'&&<><label>Categoria principal<input name="category" required placeholder="Ex.: Eletricista"/></label><label>Local de atendimento<select name="locationType" defaultValue="work"><option value="work">Endereço de trabalho</option><option value="home">Endereço residencial</option></select></label><label className="wide consent"><input type="checkbox" name="showExactLocation" value="1"/> Exibir meu ponto exato no mapa público. Se desmarcado, o ServPerto usa posição aproximada para proteger endereço residencial.</label></>}<label>Nome de login<input name="username" required minLength={4} autoCapitalize="none"/></label><label>Senha de acesso<input name="password" type="password" required minLength={8}/></label></div><button type="button" className="secondary full" onClick={()=>navigator.geolocation?.getCurrentPosition(p=>{setCoords({lat:p.coords.latitude,lng:p.coords.longitude});setMessage('')},()=>setMessage('Não foi possível obter sua localização.'))}>📍 Usar localização atual para este cadastro</button>{coords&&<div className="okText">✓ Localização capturada.</div>}{message&&<div className="errorText">{message}</div>}<button disabled={busy} className="primary full">{busy?'Criando conta...':'Criar conta'}</button></form>}</div></div>;
}

function LoginModal({onClose}:{onClose:()=>void}){
  const [mode,setMode]=useState<'login'|'recover'>('login'); const [msg,setMsg]=useState('');
  async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();const f=Object.fromEntries(new FormData(e.currentTarget).entries());try{const out=await api(mode==='login'?'/api/auth/login':'/api/auth/recover',{method:'POST',body:JSON.stringify(f)});setMsg(mode==='login'?`Bem-vindo, ${out.user.name}!`:'Senha alterada com sucesso. Você já pode entrar.');}catch(err:any){setMsg(err.message)}}
  return <div className="modalBackdrop"><div className="modal compact"><button className="close" onClick={onClose}>×</button><span className="eyebrow">ACESSO SERVPERTO</span><h2>{mode==='login'?'Entrar na plataforma':'Recuperar acesso'}</h2><form onSubmit={submit}><label>Nome de login<input name="username" required/></label>{mode==='recover'&&<label>Código de recuperação (6 dígitos)<input name="recoveryCode" required inputMode="numeric" pattern="[0-9]{6}" maxLength={6}/></label>}<label>{mode==='login'?'Senha':'Nova senha'}<input name={mode==='login'?'password':'newPassword'} type="password" required minLength={8}/></label>{msg&&<div className={msg.startsWith('Bem-vindo')||msg.startsWith('Senha alterada')?'okText':'errorText'}>{msg}</div>}<button className="primary full">{mode==='login'?'Entrar':'Alterar senha'}</button><button type="button" className="linkBtn" onClick={()=>{setMode(mode==='login'?'recover':'login');setMsg('')}}>{mode==='login'?'Esqueci minha senha':'Voltar para o login'}</button></form></div></div>;
}

function App(){
  const [register,setRegister]=useState(false); const [login,setLogin]=useState(false); const [query,setQuery]=useState('');
  const [professionals,setProfessionals]=useState<Professional[]>([]); const [userPos,setUserPos]=useState<{lat:number,lng:number}|null>(null); const [geoMsg,setGeoMsg]=useState('');
  const [geoHelp,setGeoHelp]=useState(false); const [geoLoading,setGeoLoading]=useState(false);
  useEffect(()=>{api('/api/professionals').then(setProfessionals).catch(()=>setProfessionals([]))},[]);
  const shown=useMemo(()=>professionals.filter(p=>!query||`${p.name} ${p.category}`.toLowerCase().includes(query.toLowerCase())).map(p=>({...p,distanceKm:userPos?distanceKm(userPos.lat,userPos.lng,p.latitude,p.longitude):undefined})).sort((a,b)=>userPos?(a.distanceKm!-b.distanceKm!):(b.rating-a.rating)),[professionals,query,userPos]);
  async function enableLocation(){
    setGeoMsg(''); setGeoHelp(false);
    if(!window.isSecureContext){setGeoMsg('A localização só funciona em conexão segura (HTTPS).');setGeoHelp(true);return}
    if(!navigator.geolocation){setGeoMsg('Este dispositivo ou navegador não oferece geolocalização.');setGeoHelp(true);return}
    try{if(navigator.permissions?.query){const permission=await navigator.permissions.query({name:'geolocation' as PermissionName});if(permission.state==='denied'){setGeoMsg('O acesso à localização está bloqueado no navegador.');setGeoHelp(true);return}}}catch{}
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(p=>{setUserPos({lat:p.coords.latitude,lng:p.coords.longitude});setGeoMsg('✓ Localização encontrada. Os profissionais serão ordenados pela distância até você.');setGeoHelp(false);setGeoLoading(false)},err=>{setGeoLoading(false);if(err.code===1){setGeoMsg('Você não autorizou o acesso à localização.');setGeoHelp(true)}else if(err.code===2)setGeoMsg('Não foi possível determinar sua localização neste momento.');else if(err.code===3)setGeoMsg('A busca da sua localização demorou demais. Tente novamente.');else setGeoMsg('Não foi possível acessar sua localização.')},{enableHighAccuracy:true,timeout:12000,maximumAge:60000});
  }
  return <main><nav><b>📍 ServPerto</b><div className="navActions"><span>Manaus • AM</span><button className="navLogin" onClick={()=>setLogin(true)}>Entrar</button><button className="navRegister" onClick={()=>setRegister(true)}>Cadastre-se</button></div></nav><section className="hero"><div className="heroCopy"><small>PROFISSIONAIS PERTO DE VOCÊ</small><h1>O profissional certo,<br/><em>perto de você.</em></h1><p>Encontre prestadores de serviços próximos, confira avaliações e solicite orçamento em poucos minutos.</p><div className="search"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Qual serviço você precisa?"/><button onClick={()=>document.querySelector('.results')?.scrollIntoView({behavior:'smooth'})}>Buscar profissionais</button></div><div className="locationPrompt"><button onClick={enableLocation} disabled={geoLoading}>{geoLoading?'⌛ Localizando...':'📍 Usar minha localização atual'}</button><span>{userPos?'Localização habilitada: resultados ordenados por distância.':'Opcional: permita o acesso para ver primeiro os profissionais mais próximos.'}</span></div>{geoMsg&&<div className={userPos?'okText geoNotice':'errorText geoNotice'}>{geoMsg}{geoHelp&&<button className="geoHelpBtn" onClick={()=>setGeoHelp(v=>!v)}>Como habilitar?</button>}</div>}{geoHelp&&<div className="geoHelp"><b>Como liberar a localização no Chrome</b><span>1. Clique no ícone ao lado do endereço do site.</span><span>2. Abra <strong>Configurações do site</strong>.</span><span>3. Em <strong>Localização</strong>, selecione <strong>Permitir</strong>.</span><span>4. Atualize a página e toque novamente em <strong>Usar minha localização</strong>.</span><small>Você pode pesquisar sem compartilhar sua localização. Ela é usada apenas para ordenar profissionais por proximidade.</small></div>}<div className="providerCta"><div><b>Você presta serviços?</b><span>Crie seu perfil e seja encontrado por clientes próximos.</span></div><button onClick={()=>setRegister(true)}>Cadastrar gratuitamente</button></div></div><div className="card mapCard"><MapPanel professionals={shown} userPosition={userPos} onEnableLocation={enableLocation}/><div className="mapCaption"><h3>Profissionais próximos</h3><p>Mapa próprio do ServPerto com dados do OpenStreetMap.</p></div></div></section>{shown.length>0&&<section className="results"><div className="sectionTitle"><div><small>RESULTADOS NO MAPA</small><h2>{shown.length} profissional{shown.length!==1?'is':''} encontrado{shown.length!==1?'s':''}</h2></div>{userPos&&<span>📍 Ordenados por proximidade</span>}</div><div className="resultGrid">{shown.slice(0,6).map(p=><article key={p.id}><div className="avatar">{p.name.charAt(0)}</div><div><b>{p.name}</b><span>{p.category}</span><small>{p.review_count?`${p.rating.toFixed(1)} ⭐ • ${p.review_count} avaliações`:'Novo no ServPerto'}{p.distanceKm!=null?` • ${p.distanceKm.toFixed(1)} km`:''}</small></div></article>)}</div></section>}<section className="features"><article>⭐<h3>Avaliações reais</h3><p>Reputação construída por clientes.</p></article><article>📌<h3>Busca por proximidade</h3><p>Encontre quem atende perto de você.</p></article><article>💬<h3>Orçamento rápido</h3><p>Descreva o serviço e receba propostas.</p></article></section>{register&&<RegisterModal onClose={()=>setRegister(false)}/>} {login&&<LoginModal onClose={()=>setLogin(false)}/>}</main>;
}
createRoot(document.getElementById('root')!).render(<App/>);

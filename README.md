# ServPerto 📍
MVP da plataforma para conectar clientes a prestadores de serviços próximos em Manaus.

## Arquitetura atualizada
- React + Vite + TypeScript no frontend
- Cloudflare Worker como backend
- Workers Static Assets para servir o frontend
- Cloudflare D1 para banco de dados (binding `DB`)
- Cloudflare R2 para mídia (binding `MEDIA`, será ativado quando necessário)
- Leaflet/OpenStreetMap para o mapa

> Importante: no painel do Cloudflare **não é necessário existir um preset chamado Vite**. O Vite é apenas a ferramenta de build do projeto. Para Git deploy, use **No framework / None** e configure os comandos abaixo.

## Rodar localmente
```bash
npm install
npm run dev
```

## Deploy manual
```bash
npm install
npm run deploy
```

## Deploy pelo GitHub no Cloudflare Workers Builds
1. Conecte o repositório GitHub ao Worker `servperto`.
2. Framework preset: **None / No framework** (se esse campo aparecer).
3. Root directory: `/` (ou deixe vazio se o repositório já abre nesta pasta).
4. Build command: `npm run build`.
5. Deploy command: `npx wrangler deploy`.
6. O `wrangler.jsonc` publica `dist` como Static Assets e encaminha `/api/*` para `src/worker.ts`.

## D1
Crie o banco `servperto-db`, execute `migrations/0001_init.sql` e adicione ao Worker um binding chamado `DB`.

## R2
Quando formos ativar fotos/portfólio, crie o bucket `servperto-media` e adicione um binding chamado `MEDIA`.

## Endpoints iniciais
- `/api/health` — testa o Worker.
- `/api/professionals` — lista profissionais ativos; exige D1 vinculado como `DB`.

# ServPerto 📍
MVP da plataforma para conectar clientes a prestadores de serviços próximos em Manaus.

## Stack
- React + Vite + TypeScript
- Cloudflare Pages + Pages Functions
- Cloudflare D1
- Cloudflare R2
- Mapa previsto: Leaflet/OpenStreetMap

## Rodar localmente
```bash
npm install
npm run dev
```

## Deploy
1. Envie esta pasta para um repositório GitHub.
2. No Cloudflare Pages, conecte o repositório.
3. Build command: `npm run build`.
4. Output: `dist`.
5. Crie D1 `servperto-db` e R2 `servperto-media`.
6. Configure bindings `DB` e `MEDIA` no projeto Pages.
7. Execute `migrations/0001_init.sql` no D1.

## MVP incluído
Landing page responsiva, estrutura inicial de API, endpoint `/api/health`, listagem `/api/professionals` e schema inicial D1.

## Próximas etapas
Autenticação, cadastro completo de profissionais, geolocalização/mapa, avaliações, pedidos de orçamento, assinatura/Asaas e painel administrativo.

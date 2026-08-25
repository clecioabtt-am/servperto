# ServPerto v0.6

Versão Cloudflare Workers + D1 com mapa Leaflet/OpenStreetMap, sem dependência do Google Maps.

## Deploy

```bash
npm install
npm run build
npx wrangler deploy
```

## Cloudflare

O Worker deve manter os bindings:

- `ASSETS` para os arquivos estáticos
- `DB` para o D1 `servperto-db`

Não é necessária variável ou secret do Google Maps.

## Mapa

- Frontend: Leaflet
- Tiles: OpenStreetMap
- Geocodificação de cadastro: endpoint `/api/geocode`, usando Nominatim para baixo volume
- Geolocalização do cliente: API nativa do navegador

Para produção em escala, troque os tiles/geocoder públicos por um provedor compatível sem alterar a arquitetura do mapa.


## v0.6.3
- Login abre painel autenticado automaticamente.
- Sessão persistida por token.
- Endpoint /api/me para carregar perfil do prestador.
- Painel do prestador com resumo, perfil, serviços, avaliações e plano.
- Logout revoga a sessão no D1.

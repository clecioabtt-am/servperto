# ServPerto — Workers + D1 + Google Maps

MVP para conectar clientes e prestadores em Manaus com cadastro, login, recuperação por código de 6 dígitos, geolocalização e mapa Google personalizado.

## Arquitetura
- React + Vite (build local/CI)
- Cloudflare Workers + Static Assets
- Cloudflare D1 (usuários, profissionais, serviços, avaliações)
- Google Maps JavaScript API + Advanced Markers
- Geolocation API do navegador para posição do cliente

## Deploy Cloudflare
Build: `npm run build`
Deploy: `npx wrangler deploy`
Framework preset: None / No framework

## D1
Crie `servperto-db`, execute `migrations/0001_init.sql` e adicione ao Worker o binding `DB`.

## Google Maps
No Google Cloud, crie um projeto com faturamento, habilite Maps JavaScript API e Geocoding API, crie uma API key restrita por HTTP referrers e um Map ID.
No Cloudflare > Worker servperto > Settings > Build > Variables and secrets, adicione como variáveis de BUILD:
- `VITE_GOOGLE_MAPS_API_KEY`
- `VITE_GOOGLE_MAP_ID`
Depois faça novo deploy.

Observação: variáveis `VITE_*` são compiladas no frontend e ficam visíveis no navegador. Por isso a segurança depende das restrições de domínio/API aplicadas à chave no Google Cloud.

## Privacidade da localização do prestador
O formulário oferece opção para publicar o ponto exato. Se o prestador não autorizar, a API reduz a precisão antes de salvar a coordenada pública do perfil. Para endereços residenciais, recomenda-se não publicar o ponto exato.

## Recuperação
O servidor gera um código de 6 dígitos, mostra uma única vez e armazena apenas o hash. Após 5 códigos incorretos, a recuperação fica bloqueada por 15 minutos.

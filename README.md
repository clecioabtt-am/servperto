# ServPerto v0.7

Marketplace local de serviços para Manaus/AM, publicado em Cloudflare Workers com D1.

## Principais recursos desta versão
- Busca por serviço com validação e sugestões.
- Localização por GPS ou bairro/CEP/endereço.
- Mapa Leaflet + OpenStreetMap com profissionais cadastrados.
- Cards de resultado com distância, reputação e disponibilidade.
- Perfil público individual do profissional com serviços e avaliações.
- Cadastro de cliente/prestador, login, recuperação e painel autenticado preservados.
- Seções de confiança e rodapé institucional.

## Deploy
```bash
npm install
npm run build
npx wrangler deploy
```

O binding D1 deve permanecer como `DB` e os assets como `ASSETS`.

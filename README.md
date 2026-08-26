# ServPerto v0.8.0

Marketplace local de serviços para Cloudflare Workers + D1, com frontend React/Vite e mapas Leaflet + OpenStreetMap.

## Fluxos implementados

- Cadastro de cliente e prestador com recuperação por código de 6 dígitos.
- Login, sessão, logout e troca de senha.
- Busca de profissionais, geolocalização, mapa e perfis públicos.
- Favoritos do cliente.
- Solicitação de orçamento vinculada a um profissional.
- Painel do prestador com pedidos recebidos.
- Envio/edição de orçamento pelo prestador.
- Aceite/recusa de orçamento pelo cliente.
- Início e conclusão do serviço pelo prestador.
- Avaliação liberada apenas para serviço concluído e orçamento aceito.
- Reputação recalculada automaticamente no perfil profissional.
- Gestão de serviços e disponibilidade pelo prestador.

## Deploy

1. Execute as migrações do diretório `migrations/` no D1 na ordem 0001, 0002 e 0003, usando apenas as que ainda não foram aplicadas.
2. Garanta os bindings `DB -> servperto-db` e `ASSETS`.
3. `npm install`
4. `npm run build`
5. `npx wrangler deploy`

Teste `/api/schema-health` após o deploy.

# ServPerto v0.9.0

Marketplace local de serviços em Cloudflare Workers + D1, com React/Vite, Leaflet e OpenStreetMap.

## Principais recursos

- cadastro e login de clientes e prestadores;
- recuperação de senha por código de 6 dígitos;
- busca e mapa público de profissionais;
- mapa dentro do painel do cliente com filtro por categoria;
- solicitação, orçamento, aceite, início e conclusão do serviço;
- chat privado liberado somente após o aceite do orçamento;
- mensagens de texto e compartilhamento de localização pelo cliente;
- encerramento do chat pelo cliente;
- uma avaliação por serviço concluído, de 1 a 5 estrelas;
- favoritos;
- foto de perfil opcional para cliente e prestador;
- painel específico para cliente e prestador.

## Banco D1

Aplique as migrations na ordem. Para atualizar uma instalação v0.8 para v0.9, execute `migrations/0004_chat_profile_map.sql` **uma única vez** no D1 Studio antes do deploy da v0.9.

> A migration 0004 pressupõe que `0002_client_requests.sql` já foi aplicada e que `service_requests.target_provider_id` existe.

## Cloudflare

Mantenha o binding D1 `DB` conectado ao banco `servperto-db` e o binding `ASSETS` configurado pelo `wrangler.jsonc`.

Após o deploy, teste `/api/schema-health`. O retorno deve conter `"ok": true`.

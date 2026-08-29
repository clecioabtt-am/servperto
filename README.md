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


## v0.9.1
- Corrige erro do chat `Cannot read properties of null (reading reset)` preservando a referência do formulário antes da operação assíncrona.
- Reorganiza os cards de profissionais no painel do cliente para evitar informações cortadas.
- Exibe nome, avaliação, categoria, cidade, distância, disponibilidade e descrição de forma responsiva.

## ServPerto v1.0 — PWA e responsividade
- Layout otimizado para desktop, tablets e smartphones Android.
- Manifesto PWA e Service Worker incluídos.
- Instalação na tela inicial pelo botão “Instalar ServPerto” quando suportado pelo navegador.
- Em Android/Chrome, também pode ser instalado pelo menu do navegador → “Instalar app” / “Adicionar à tela inicial”.
- Cache apenas de recursos públicos; rotas `/api/*` continuam online e não são armazenadas pelo Service Worker.


## ServPerto v1.1
Inclui marcadores com foto de perfil no mapa, central de notificações, agenda de atendimentos, portfólio profissional e selos de reputação. Execute `migrations/0005_professional_evolution.sql` uma única vez no D1 antes do deploy da v1.1.


## ServPerto v1.2.0 — Suporte, status e marcador profissional

Esta versão adiciona:

- foto do prestador recortada corretamente dentro do pin do mapa;
- pin verde para profissional disponível e laranja para indisponível;
- profissionais indisponíveis continuam visíveis no mapa, mas não recebem novas solicitações;
- seletor de status no perfil do prestador;
- opção de exclusão/desativação da própria conta para clientes e prestadores;
- painel de Suporte / Administração;
- remoção e reativação de contas pelo suporte;
- verificação/desverificação de prestadores;
- moderação e remoção de avaliações com recálculo automático da nota.

### Migração obrigatória

Antes de usar o painel de suporte, execute **uma vez** no D1 o arquivo:

`migrations/0006_support_admin.sql`

A conta administrativa criada pela migração usa o login `suporte.servperto`. A senha temporária e o código de recuperação não ficam em texto puro dentro do repositório.


## v1.4 - Localização do prestador por GPS
- O marcador do prestador no mapa agora pode ser atualizado diretamente no painel **Meu perfil**.
- Botão: **Atualizar minha localização pelo GPS**.
- A plataforma usa `navigator.geolocation` com alta precisão e grava latitude/longitude em `provider_profiles`.
- O endereço cadastrado continua sendo um dado de perfil, mas não é usado para reposicionar o marcador no mapa.
- Esta atualização não exige nova migração D1.


## v1.4 — Localização ao vivo, presença e privacidade
- Prestador pode iniciar/parar compartilhamento de localização em tempo real pelo GPS.
- Prestador pode ocultar ou desocultar sua localização do mapa.
- O mapa consulta novas posições periodicamente para atualizar marcadores ativos.
- Painel do prestador mostra total de clientes, online e offline.
- Cliente é considerado online quando o painel autenticado envia presença nos últimos 2 minutos.
- Cliente e prestador podem escolher se o número de WhatsApp fica visível.
- Privacidade é respeitada nas APIs: coordenadas ocultas e WhatsApp oculto não são enviados publicamente.

> Importante: em navegadores/PWA, a localização em tempo real funciona enquanto a página/app permanece ativa. iOS e alguns Androids podem suspender geolocalização em segundo plano ou com a tela bloqueada.

Antes do deploy execute `migrations/0007_realtime_privacy_presence.sql` uma única vez no D1 `servperto-db`.

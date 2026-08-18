# ServPerto v0.5 — D1 conectado

Versão alinhada ao banco Cloudflare D1 `servperto-db`.

## Recursos desta versão
- Cadastro de cliente e prestador gravando no D1.
- Senhas protegidas com PBKDF2 + salt armazenado no próprio hash.
- Código de recuperação de 6 dígitos protegido por hash e bloqueio por tentativas.
- Login com criação de sessão de 7 dias.
- Recuperação de senha revogando sessões antigas.
- Cadastro do prestador em `provider_profiles` + `provider_services`.
- Endpoint `/api/db-health` para verificar a conexão com o D1.
- Listagem de profissionais para o mapa usando a estrutura real do banco.
- Binding D1 versionado em `wrangler.jsonc`.

## Testes após o deploy
- `/api/health`
- `/api/db-health`

O banco remoto já foi criado no painel. Não execute novamente a migration no banco existente sem necessidade.

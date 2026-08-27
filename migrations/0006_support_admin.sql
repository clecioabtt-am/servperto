-- ServPerto v1.2.0 - Conta inicial de Suporte / Administração
-- Execute UMA ÚNICA VEZ no D1 após as migrações anteriores.
-- A senha temporária e o código de recuperação foram entregues fora do repositório.

INSERT OR IGNORE INTO users (
  role, full_name, phone, cep, address, city, state, username,
  password_hash, recovery_code_hash, recovery_attempts, active, created_at, updated_at
) VALUES (
  'admin',
  'Suporte ServPerto',
  '00000000000',
  '00000-000',
  'Painel administrativo',
  'Manaus',
  'AM',
  'suporte.servperto',
  '3a6e62fe0c1763cf97fdfd5f31462895$efb4cfa1932777eba908db2afd62a4172a46889a7e4451788e7cf1bf44743bb4',
  '3d206e934e2151333ab1429fe46e2c02$c7aa853c2abe484e870733517cc81aacecc3615d7b6ac5643333b2615cc77f60',
  0,
  1,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

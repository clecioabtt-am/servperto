-- ServPerto v1.5.0 - Código de recuperação inicial do perfil de suporte
-- Execute UMA ÚNICA VEZ no D1 depois da migration 0007.
-- O código correspondente foi entregue separadamente ao responsável.

UPDATE users
SET recovery_code_hash = 'ae41f8b53abf72fb7c86cf004f693816$70d6b447cb8454b37e7a425d297396c1ab7e95c22b0fe7c3a486be4a06cd2416',
    recovery_attempts = 0,
    recovery_locked_until = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE username = 'suporte.servperto' AND role = 'admin';

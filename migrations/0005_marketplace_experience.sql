-- ServPerto v0.9.2 - visibilidade individual do chat.
-- Execute uma única vez após a migration 0004.
ALTER TABLE service_chats ADD COLUMN client_hidden INTEGER NOT NULL DEFAULT 0;
ALTER TABLE service_chats ADD COLUMN provider_hidden INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_service_chats_client_hidden ON service_chats(client_hidden);
CREATE INDEX IF NOT EXISTS idx_service_chats_provider_hidden ON service_chats(provider_hidden);

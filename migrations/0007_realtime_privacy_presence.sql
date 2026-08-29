-- ServPerto v1.4.0 — presença, privacidade e localização em tempo real
-- Execute UMA ÚNICA VEZ no banco D1 servperto-db, após a migração 0006.

ALTER TABLE users ADD COLUMN whatsapp_public INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN last_seen TEXT;

ALTER TABLE provider_profiles ADD COLUMN map_visible INTEGER NOT NULL DEFAULT 1;
ALTER TABLE provider_profiles ADD COLUMN live_location_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE provider_profiles ADD COLUMN live_location_updated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_users_role_last_seen ON users(role, active, last_seen);
CREATE INDEX IF NOT EXISTS idx_provider_map_visible ON provider_profiles(map_visible, available);
CREATE INDEX IF NOT EXISTS idx_provider_live_location ON provider_profiles(live_location_enabled, live_location_updated_at);

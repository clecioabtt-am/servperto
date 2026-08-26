-- ServPerto v0.7.1: vincula a solicitação ao profissional escolhido pelo cliente.
ALTER TABLE service_requests ADD COLUMN target_provider_id INTEGER REFERENCES provider_profiles(id);
CREATE INDEX IF NOT EXISTS idx_requests_target_provider ON service_requests(target_provider_id);

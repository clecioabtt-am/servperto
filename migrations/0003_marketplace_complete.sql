-- ServPerto v0.8.0 - Marketplace completo.
-- Não cria novas colunas além da migração 0002. Reforça índices usados no fluxo operacional.
CREATE INDEX IF NOT EXISTS idx_quotes_request_provider ON quotes(request_id, provider_id);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);
CREATE INDEX IF NOT EXISTS idx_reviews_request ON reviews(request_id);
CREATE INDEX IF NOT EXISTS idx_favorites_client ON favorites(client_id);
CREATE INDEX IF NOT EXISTS idx_favorites_provider ON favorites(provider_id);
CREATE INDEX IF NOT EXISTS idx_requests_target_provider ON service_requests(target_provider_id);

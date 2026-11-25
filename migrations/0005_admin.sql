-- Painel do dono: último acesso de cada usuário (fora da tabela users, porque
-- ALTER TABLE ADD COLUMN não aceita IF NOT EXISTS e as migrações precisam ser idempotentes).
CREATE TABLE IF NOT EXISTS user_activity (
  user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_seen_at  INTEGER NOT NULL
);

-- Mensagens com a chave de IA do app (o custo do Gemini) voltam a ser contadas em
-- ai_usage(user_id, day, count), criada na 0002. Índice pra somar por dia no painel.
CREATE INDEX IF NOT EXISTS ai_usage_day ON ai_usage(day);

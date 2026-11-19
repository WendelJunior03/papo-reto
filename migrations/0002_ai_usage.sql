-- Quantas mensagens cada usuário mandou pra IA por dia (limite de gasto).
CREATE TABLE IF NOT EXISTS ai_usage (
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day      TEXT    NOT NULL,
  count    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

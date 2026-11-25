-- Historinhas geradas com a chave de IA do app, por usuário e dia (limite diário,
-- separado da sessão de conversa de 7 minutos). Chave própria do usuário não conta aqui.
CREATE TABLE IF NOT EXISTS story_usage (
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day      TEXT    NOT NULL,            -- dia no horário de Brasília (AAAA-MM-DD)
  count    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

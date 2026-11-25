-- Lembrete diário por notificação, no horário que a pessoa escolheu (no fuso dela).
CREATE TABLE IF NOT EXISTS reminders (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  time       TEXT    NOT NULL,            -- "HH:MM" no horário local
  tz         TEXT    NOT NULL,            -- fuso IANA, ex.: America/Sao_Paulo
  enabled    INTEGER NOT NULL DEFAULT 1,
  last_sent  TEXT                         -- último dia (local, AAAA-MM-DD) em que o lembrete saiu
);

-- Texto da última notificação de cada tipo. O push chega sem conteúdo e o
-- service worker busca aqui o que mostrar (/api/push/latest). Uma linha por usuário e tipo.
CREATE TABLE IF NOT EXISTS push_outbox (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL,
  title       TEXT    NOT NULL,
  body        TEXT    NOT NULL,
  url         TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind)
);

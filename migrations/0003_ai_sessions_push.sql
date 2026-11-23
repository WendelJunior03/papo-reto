-- Sessões de conversa com a IA do app (7 min de conversa, depois 1 h de espera).
CREATE TABLE IF NOT EXISTS ai_sessions (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  started_at  INTEGER NOT NULL,
  ends_at     INTEGER NOT NULL,
  messages    INTEGER NOT NULL DEFAULT 0
);

-- Inscrições de notificação (Web Push) de cada aparelho.
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint    TEXT    PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  p256dh      TEXT    NOT NULL,
  auth        TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS push_subs_user ON push_subs(user_id);

-- Avisos agendados (ex.: "sua conversa liberou"), enviados pelo cron do Worker.
CREATE TABLE IF NOT EXISTS push_jobs (
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind     TEXT    NOT NULL,
  due_at   INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind)
);
CREATE INDEX IF NOT EXISTS push_jobs_due ON push_jobs(due_at);

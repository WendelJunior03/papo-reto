-- Usuários e sessões. Mesmo SQL no SQLite local (bun:sqlite) e no Cloudflare D1.
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  username        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash       TEXT    NOT NULL,
  pass_salt       TEXT    NOT NULL,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  -- progresso do app (JSON), sincronizado entre aparelhos
  progress        TEXT,
  progress_at     TEXT,
  -- proteção contra chute de senha
  failed_logins   INTEGER NOT NULL DEFAULT 0,
  locked_until    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT    PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

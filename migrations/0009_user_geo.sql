-- Cidade aproximada de cada pessoa (vem do Cloudflare pela conexão, sem GPS), pro painel do dono.
CREATE TABLE IF NOT EXISTS user_geo (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  city       TEXT,
  region     TEXT,
  country    TEXT,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS user_geo_place ON user_geo(country, region, city);

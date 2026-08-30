-- Bootstrap a role + database for tiktok-gram against an EXISTING external
-- Postgres server. Not needed for the bundled `docker compose up -d` setup
-- (deploy/pi/docker-compose.yml's postgres service creates the role/DB from
-- POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB automatically) — use this only
-- if you're pointing POSTGRES_URL at a Postgres instance you already run.
--
-- Usage: psql -U postgres -f scripts/setup-pi-database.sql
--
-- Change the password before using this anywhere but local dev.
CREATE USER tiktok_gram_app WITH PASSWORD 'tiktok_gram_change_me';

CREATE DATABASE tiktok_gram
  OWNER tiktok_gram_app
  ENCODING 'UTF8'
  LC_COLLATE 'C.UTF-8'
  LC_CTYPE 'C.UTF-8'
  TEMPLATE template0;

\c tiktok_gram

GRANT ALL ON SCHEMA public TO tiktok_gram_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO tiktok_gram_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO tiktok_gram_app;

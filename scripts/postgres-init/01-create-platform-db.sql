-- The shared postgres server hosts two logically separate databases: the
-- white-label's `whitelabel` (created by the image via POSTGRES_DB) and the
-- platform's `crash_pilot` (bets/rounds, used when the platform runs with
-- DB_DRIVER=postgres). This script runs only on a FRESH data volume
-- (docker-entrypoint-initdb.d). On an existing volume create it manually:
--   docker compose exec postgres createdb -U whitelabel crash_pilot
CREATE DATABASE crash_pilot;

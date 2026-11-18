#!/bin/bash
# Least-privilege runtime role for the kitchen app.
#
# Runs ONLY on first volume init (docker-entrypoint-initdb.d). An EXISTING
# volume must have this applied by hand:
#   docker exec -i cookingstudio-postgres-1 psql -U kitchen -d kitchen < this-file's-SQL
#
# The app connects as `kitchen_app` (CRUD, no DDL). Schema changes
# (`prisma/migrate.ts`) still need the OWNER role `kitchen`.
set -euo pipefail

if [ -z "${APP_DB_PASSWORD:-}" ]; then
  echo "init-app-user: APP_DB_PASSWORD is not set — refusing to create a passwordless role" >&2
  exit 1
fi

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  DO \$\$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'kitchen_app') THEN
      CREATE ROLE kitchen_app LOGIN PASSWORD '${APP_DB_PASSWORD}';
    ELSE
      ALTER ROLE kitchen_app PASSWORD '${APP_DB_PASSWORD}';
    END IF;
  END \$\$;

  -- No CREATE on the schema: the runtime role must not be able to run DDL.
  REVOKE ALL ON SCHEMA public FROM kitchen_app;
  GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO kitchen_app;
  GRANT USAGE ON SCHEMA public TO kitchen_app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO kitchen_app;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kitchen_app;

  -- Tables created later by the owner (schema migrations) inherit the same grants.
  ALTER DEFAULT PRIVILEGES FOR ROLE ${POSTGRES_USER} IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO kitchen_app;
  ALTER DEFAULT PRIVILEGES FOR ROLE ${POSTGRES_USER} IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO kitchen_app;
EOSQL

echo "init-app-user: kitchen_app role ready (CRUD only, no DDL)"

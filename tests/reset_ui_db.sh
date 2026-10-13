#!/usr/bin/env bash
# Recreates the fleet_ui demo database used by the browser tests.
set -euo pipefail
cd "$(dirname "$0")"
P="psql -h /tmp -p 5433 -U postgres -q -v ON_ERROR_STOP=1"
$P -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname='fleet_ui' and pid<>pg_backend_pid()" >/dev/null
$P -d postgres -c "drop database if exists fleet_ui" -c "create database fleet_ui"
$P -d fleet_ui -f supabase_stub.sql -f ../supabase/setup_clean.sql -f ui_seed.sql 2>&1 | grep -v NOTICE || true
echo "fleet_ui ready"

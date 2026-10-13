#!/usr/bin/env bash
# Starts the local PostgreSQL test server and the mock Supabase server if they are not running.
set -u
cd "$(dirname "$0")"
PGBIN=/usr/lib/postgresql/16/bin
DATA=/var/lib/postgresql/fleettest
LOGDIR=${LOGDIR:-/tmp}
if ! psql -h /tmp -p 5433 -U postgres -Atqc "select 1" >/dev/null 2>&1; then
  rm -f "$DATA/postmaster.pid"
  su postgres -c "$PGBIN/pg_ctl -D $DATA -o '-p 5433 -k /tmp' -l /var/lib/postgresql/fleet.log start -w" >/dev/null
fi
psql -h /tmp -p 5433 -U postgres -Atqc "select 'postgres ok'"
if ! curl -s -o /dev/null http://localhost:8787/; then
  nohup python3 -I mock_supabase.py --db fleet_ui --port 8787 --web "$(cd ../web && pwd)" > "$LOGDIR/mock.log" 2>&1 &
  sleep 1.5
fi
curl -s -o /dev/null -w "mock %{http_code}\n" http://localhost:8787/

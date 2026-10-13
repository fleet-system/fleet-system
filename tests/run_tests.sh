#!/usr/bin/env bash
# يُنشئ قاعدة اختبار جديدة، يطبّق ملفات المخطط بالترتيب، ثم يشغّل الاختبارات.
# الاستخدام: PGHOST=/tmp PGPORT=5433 PGUSER=postgres ./run_tests.sh
set -euo pipefail
cd "$(dirname "$0")"
DB=fleet_test
psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
run() { psql -q -v ON_ERROR_STOP=1 -d $DB -f "$1"; }
run supabase_stub.sql
for f in ../supabase/migrations/*.sql; do echo ">> $f"; run "$f"; done
psql -v ON_ERROR_STOP=1 -d $DB -f schema_tests.sql 2>&1 | sed -e 's/^psql:[^ ]* NOTICE:  //'

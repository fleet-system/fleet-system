#!/usr/bin/env bash
# Runs every automated check in order and prints one summary line per suite.
# Usage: bash tests/run_all.sh [OUTDIR]
set -u
cd "$(dirname "$0")"
OUT=${1:-/tmp/fleet-test-out}; mkdir -p "$OUT"
export PGHOST=/tmp PGPORT=5433 PGUSER=postgres
LOGDIR="$OUT" bash start_local.sh >/dev/null
summary=()
note() { summary+=("$1"); echo "$1"; }

n=$(bash run_tests.sh 2>&1 | tee "$OUT/db.log" | grep -c '^PASS'); err=$(grep -c 'ERROR' "$OUT/db.log")
note "database rules (schema_tests.sql): PASS $n, FAIL $err"
for tz in UTC America/New_York Asia/Riyadh Pacific/Kiritimati; do note "$(TZ=$tz node unit_js.mjs | head -1)"; done

for t in ui_check ui_phase3 ui_phase4 ui_phase5 ui_phase6 ui_phase7 ui_requests ui_freetext ui_nav ui_mobile_field ui_persistence ui_vehicle_card ui_backup ui_insurance_owner ui_vehicle_admin ui_logo ui_request_archive ui_vehicle_auth robust_ui; do
  bash reset_ui_db.sh >/dev/null
  python3 -I $t.py "$OUT/$t" > "$OUT/$t.log" 2>&1
  note "$t: $(grep -E '^(PASS|PASSED|ALL UI CHECKS PASSED)' "$OUT/$t.log" | head -1) $(grep -E '^FAIL' "$OUT/$t.log" | head -1) $(grep -c Traceback "$OUT/$t.log") crash"
done
python3 -I backup_restore_tests.py > "$OUT/backup_db.log" 2>&1
note "backup_restore_tests (scratch DB): $(grep -E '^PASS' "$OUT/backup_db.log") $(grep -E '^FAIL' "$OUT/backup_db.log")"
bash reset_ui_db.sh >/dev/null
python3 -I security_probe.py > "$OUT/security.log" 2>&1
note "security_probe: $(grep -E '^PASS' "$OUT/security.log") $(grep -E '^FAIL' "$OUT/security.log")"
bash reset_ui_db.sh >/dev/null
psql -d fleet_ui -q -v ON_ERROR_STOP=1 -f bulk_seed.sql >/dev/null 2>&1
python3 -I calc_audit.py > "$OUT/calc.log" 2>&1
note "calc_audit (large data): $(grep -E '^PASS' "$OUT/calc.log") $(grep -E '^FAIL' "$OUT/calc.log")"
python3 -I bulk_ui.py "$OUT/bulk" > "$OUT/bulk.log" 2>&1
note "bulk_ui (large data, 1000-row cap): $(grep -E '^PASS' "$OUT/bulk.log") $(grep -E '^FAIL' "$OUT/bulk.log")"
bash reset_ui_db.sh >/dev/null
echo; echo "===== SUMMARY ====="; printf '%s\n' "${summary[@]}"

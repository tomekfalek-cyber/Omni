#!/bin/sh
# Rytm eval Omni: uruchamia wszystkie evale sekwencyjnie i dopisuje wyniki do historii.
# Uruchamiane przez omni-eval.timer (systemd --user).
cd /home/openclaw/omni || exit 1
HIST=/home/openclaw/.omni/logs/eval-history.log
mkdir -p "$(dirname "$HIST")"
TS=$(date -Iseconds)
{
  echo "=== $TS ==="
  for t in eval-rozum eval-sysadmin eval-koder eval-projekt eval-fix; do
    F="/tmp/omni-eval-$t.out"
    timeout 1200 node "tools/$t.mjs" > "$F" 2>&1
    L=$(grep -aE '^WYNIK_' "$F" | tail -1)
    echo "$t: ${L:-BRAK}"
  done
} >> "$HIST" 2>&1

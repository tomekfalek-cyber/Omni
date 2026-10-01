#!/bin/sh
# Omni: publikuje aktualny adres tunelu w docs/address.json (dla strony instalacyjnej na GitHub Pages).
# Uruchamiane automatycznie. Czyta token z zaszyfrowanego magazynu OpenClaw - nigdy go nie zapisuje na stale.
REPO=/home/openclaw/omni
LOG=$REPO/tunnel.log
JSON=$REPO/docs/address.json
NODE=/home/openclaw/.openclaw/tools/node-v24.19.0/bin/node

DOMAIN=$(cat /home/openclaw/.omni/ngrok-domain.txt 2>/dev/null | tr -d ' ')
if [ -n "$DOMAIN" ]; then
  URL="https://$DOMAIN"
else
  URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG" 2>/dev/null | tail -1)
fi
[ -z "$URL" ] && exit 0

CUR=$(sed -n 's/.*"url"[ ]*:[ ]*"\([^"]*\)".*/\1/p' "$JSON" 2>/dev/null | head -1)
[ "$URL" = "$CUR" ] && exit 0

printf '{\n  "url": "%s"\n}\n' "$URL" > "$JSON"

TOKEN=$("$NODE" -e "const s=require('node:sqlite');const db=new s.DatabaseSync('/home/openclaw/.openclaw/state/openclaw.sqlite');const r=db.prepare(\"select value from secret_store_entries where name='GITHUB_TOKEN' and deleted_at_ms is null order by updated_at_ms desc limit 1\").get();process.stdout.write(r?r.value:'')" 2>/dev/null)
[ -z "$TOKEN" ] && exit 0

cd "$REPO" || exit 0
git add docs/address.json
git -c user.name=omni-bot -c user.email=bot@omni.local commit -q -m "chore: aktualny adres Omni dla strony instalacyjnej" 2>/dev/null

cat > /tmp/ap-omni.sh <<APEOF
#!/bin/sh
case "\$1" in
  *sername*) echo "tomekfalek-cyber" ;;
  *) printf '%s' "$TOKEN" ;;
esac
APEOF
chmod 700 /tmp/ap-omni.sh
GIT_ASKPASS=/tmp/ap-omni.sh GIT_TERMINAL_PROMPT=0 git push origin main 2>&1 | tail -1
rm -f /tmp/ap-omni.sh
echo "Opublikowano adres: $URL"

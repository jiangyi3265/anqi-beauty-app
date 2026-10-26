#!/usr/bin/env bash
# Publish the verified 1.1.39 business API, Java gateway, H5, and admin UI.
set -euo pipefail
umask 077
release=/opt/anqi/releases/20261025-v1.1.39
cd "$release"

test ! -e published.ok
sha256sum -c release.sha256
sha256sum -c baseline.sha256
test ! -e stage
mkdir stage
tar -xzf release.tgz -C stage
test -s stage/frontend/index.html
test -s stage/admin/index.html
test -s stage/java/ruoyi-admin.jar
test -s stage/sql/anqi-redemptions-delivery.sql
grep -q '"version": "1.1.39"' stage/business/package.json
for file in stage/business/server/*.cjs inventory.cjs; do /opt/anqi/node/bin/node --check "$file"; done
for file in trial-catalogue.json vip-catalogue.json; do
  cmp -s "stage/business/common/$file" "/opt/anqi/business/common/$file"
done
/opt/anqi/node/bin/node -e 'const v=require("/opt/anqi/business/package.json").version;if(v!=="1.1.38")throw Error("Unexpected live version: "+v)'
/opt/anqi/node/bin/node - <<'NODE'
const assert=require('node:assert/strict');
const old=require('/opt/anqi/business/package-lock.json');
const next=require('./stage/business/package-lock.json');
delete old.packages[''];delete next.packages[''];
assert.deepEqual(next.packages,old.packages,'Dependencies changed; prepare node_modules first');
NODE
/www/server/nginx/sbin/nginx -t
systemctl is-active anqi-business anqi-backend anqi-mysql anqi-redis
curl -fsS http://127.0.0.1:8097/api/bootstrap > before-bootstrap.json
/opt/anqi/node/bin/node -e 'const b=require(process.argv[1]);if(b.build?.businessVersion!=="1.1.38")throw Error("Unexpected API baseline")' "$release/before-bootstrap.json"

if [ ! -s before-inventory.json ]; then
  /opt/anqi/node/bin/node --env-file=/opt/anqi/shared/business.env inventory.cjs before
fi
test -s before-database.sql
if [ ! -s before-code-sites.tgz ]; then
  tar -czf before-code-sites.tgz --exclude=static/uploads --exclude=.user.ini -C / \
    opt/anqi/business/server opt/anqi/business/package.json opt/anqi/business/package-lock.json \
    opt/anqi/ruoyi/ruoyi-admin.jar www/wwwroot/anqi.okam.top www/wwwroot/anqiht.okam.top
fi
test -s before-code-sites.tgz
tar -tzf before-code-sites.tgz >/dev/null

cat > rollback-code.sh <<'ROLLBACK'
#!/usr/bin/env bash
set -euo pipefail
systemctl stop anqi-backend anqi-business || true
tar -xzf /opt/anqi/releases/20261025-v1.1.39/before-code-sites.tgz -C /
systemctl start anqi-business anqi-backend
systemctl is-active anqi-business anqi-backend
echo 'Code, Java, and sites restored from the pre-release backup; business data retained.'
ROLLBACK
chmod 700 rollback-code.sh
trap 'echo "Publish failed; restoring the previous code and sites" >&2; bash "$release/rollback-code.sh"' ERR

systemctl stop anqi-backend anqi-business
rsync -a --chown=anqi:anqi stage/business/server/ /opt/anqi/business/server/
install -o anqi -g anqi -m 644 stage/business/package.json /opt/anqi/business/package.json
install -o anqi -g anqi -m 644 stage/business/package-lock.json /opt/anqi/business/package-lock.json
install -o anqi -g anqi -m 644 stage/java/ruoyi-admin.jar /opt/anqi/ruoyi/ruoyi-admin.jar

for target in frontend admin; do
  if [ "$target" = frontend ]; then root=/www/wwwroot/anqi.okam.top; else root=/www/wwwroot/anqiht.okam.top; fi
  rsync -a --chown=www:www --chmod=D755,F644 --exclude=index.html --exclude=static/uploads/ "stage/$target/" "$root/"
  install -o www -g www -m 644 "stage/$target/index.html" "$root/index.next.html"
  mv -f "$root/index.next.html" "$root/index.html"
  cmp -s "stage/$target/index.html" "$root/index.html"
done

python3 - <<'PY'
import json, os, subprocess
credentials=json.load(open('/opt/anqi/shared/credentials.json'))
env=os.environ.copy()
env['MYSQL_PWD']=credentials['dbPassword']
with open('stage/sql/anqi-redemptions-delivery.sql','rb') as source:
    subprocess.run(['mysql','-h','127.0.0.1','-P','3309','-u',credentials['dbUser'],credentials['dbName']],stdin=source,env=env,check=True)
PY

systemctl start anqi-business anqi-backend
healthy=false
for i in $(seq 1 90); do
  if curl -fsS http://127.0.0.1:8097/api/health > health.json 2>/dev/null; then healthy=true; break; fi
  sleep 1
done
[ "$healthy" = true ]
curl -fsS http://127.0.0.1:8097/api/bootstrap > bootstrap.json
/opt/anqi/node/bin/node -e 'const b=require(process.argv[1]);if(b.build?.businessVersion!=="1.1.39"||b.config.version!=="1.1.39")throw Error("Business version mismatch")' "$release/bootstrap.json"
code=$(curl -sS -o invite-unauthorized.json -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:8097/api/invite/bind)
[ "$code" = 401 ]
code=$(curl -sS -o /dev/null -w '%{http_code}' --resolve anqi.okam.top:443:127.0.0.1 https://anqi.okam.top/)
[ "$code" = 410 ]
curl -fsS --resolve anqiht.okam.top:443:127.0.0.1 https://anqiht.okam.top/ -o admin-live.html
cmp -s stage/frontend/index.html /www/wwwroot/anqi.okam.top/index.html
cmp -s stage/admin/index.html admin-live.html
/opt/anqi/node/bin/node --env-file=/opt/anqi/shared/business.env inventory.cjs after
systemctl is-active anqi-business anqi-backend anqi-mysql anqi-redis
touch published.ok
trap - ERR
echo 'Published server, H5, Java, and admin 1.1.39. Upload the separate mini-program experience build next.'

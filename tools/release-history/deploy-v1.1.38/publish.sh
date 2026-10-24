#!/usr/bin/env bash
# 1.1.38：在已上线的 1.1.36 上更新业务服务、用户端 H5 和管理后台（1.1.37 已作废，从未上线）。
# 新增：只有超级VIP会员（持有未退款的 VIP 套餐卡）才有专属二维码、才能推荐人；推荐奖励只算直接推荐（首单50%、之后10%），没有一层一层。
# 不需要 post-config；Java 程序、数据库结构、店铺配置、推荐奖励与分红池设置均不改动。
set -euo pipefail
umask 077
release=/opt/anqi/releases/20261023-v1.1.38
cd "$release"
test ! -e published.ok
sha256sum -c release.sha256
rm -rf stage && mkdir stage
tar -xzf release.tgz -C stage
for f in stage/business/server/*.cjs stage/business/tools/*.cjs inventory.cjs; do /opt/anqi/node/bin/node --check "$f"; done
test -s stage/frontend/index.html && test -s stage/admin/index.html
grep -q '"version": "1.1.38"' stage/business/package.json
# 服务端还读取 common/ 下两份目录文件；本版未改动，核对线上与包内一致
for f in trial-catalogue.json vip-catalogue.json; do cmp -s "stage/business/common/$f" "/opt/anqi/business/common/$f" || { echo "线上 common/$f 与本包不一致，停止发布" >&2; exit 1; }; done
# 本包基于线上 1.1.36，版本不符时停止
/opt/anqi/node/bin/node -e 'const v=require("/opt/anqi/business/package.json").version;if(v!=="1.1.36")throw Error("线上业务服务是 "+v+"，本包要求基线 1.1.36")'
/opt/anqi/node/bin/node - <<'NODE'
const assert=require('assert/strict');
const old=require('/opt/anqi/business/package-lock.json'), next=require('./stage/business/package-lock.json');
delete old.packages[''];delete next.packages[''];
assert.deepEqual(next.packages,old.packages,'依赖发生变化，需先准备依赖');
NODE
# 新规则依赖“推荐人须办卡”开着（老的推荐关系里，推荐人没卡就不拿钱）；没开就停止，先在后台打开再发布
curl -fsS http://127.0.0.1:8097/api/bootstrap > before-bootstrap.json
/opt/anqi/node/bin/node -e 'const r=require(process.argv[1]).config.referralReward||{};if(r.requireCard!==true)throw Error("线上“推荐人须办卡”没有开启，停止发布")' "$release/before-bootstrap.json"
/www/server/nginx/sbin/nginx -t
sha256sum /opt/anqi/ruoyi/ruoyi-admin.jar | tee java-unchanged.sha256
if [ ! -s before-inventory.json ]; then /opt/anqi/node/bin/node --env-file=/opt/anqi/shared/business.env inventory.cjs before; fi
if [ ! -s before-code-sites.tgz ]; then
 tar -czf before-code-sites.tgz --exclude=static/uploads --exclude=.user.ini -C / opt/anqi/business/server opt/anqi/business/package.json opt/anqi/business/package-lock.json opt/anqi/business/tools www/wwwroot/anqi.okam.top www/wwwroot/anqiht.okam.top
fi
cat > rollback-code.sh <<'ROLLBACK'
#!/usr/bin/env bash
set -uo pipefail
systemctl stop anqi-business
tar -xzf /opt/anqi/releases/20261023-v1.1.38/before-code-sites.tgz --exclude='*/.user.ini' -C /
result=$?
systemctl start anqi-business
echo '已恢复 1.1.36 的业务代码、H5 和后台；业务数据保留。'
exit "$result"
ROLLBACK
chmod 700 rollback-code.sh
trap 'echo "发布失败，恢复原代码。" >&2; bash "$release/rollback-code.sh"' ERR
systemctl stop anqi-business
rsync -a --chown=anqi:anqi stage/business/server/ /opt/anqi/business/server/
install -o anqi -g anqi -m 644 stage/business/tools/wechat-pay-check.cjs /opt/anqi/business/tools/wechat-pay-check.cjs
install -o anqi -g anqi -m 644 stage/business/package.json /opt/anqi/business/package.json
install -o anqi -g anqi -m 644 stage/business/package-lock.json /opt/anqi/business/package-lock.json
for target in frontend admin; do
 if [ "$target" = frontend ]; then root=/www/wwwroot/anqi.okam.top; else root=/www/wwwroot/anqiht.okam.top; fi
 rsync -a --chown=www:www --chmod=D755,F644 --exclude=index.html --exclude=static/uploads/ "stage/$target/" "$root/"
 install -o www -g www -m 644 "stage/$target/index.html" "$root/index.next.html"
 mv -f "$root/index.next.html" "$root/index.html"
 cmp -s "stage/$target/index.html" "$root/index.html"
done
systemctl start anqi-business
healthy=false
for i in $(seq 1 90); do
 if curl -fsS http://127.0.0.1:8097/api/health > health.json 2>/dev/null; then healthy=true; break; fi
 sleep 1
done
[ "$healthy" = true ]
curl -fsS http://127.0.0.1:8097/api/bootstrap > bootstrap.json
/opt/anqi/node/bin/node -e 'const b=require(process.argv[1]);if(b.config.version!=="1.1.38")throw Error("业务服务版本不是 1.1.38")' "$release/bootstrap.json"
/opt/anqi/node/bin/node --env-file=/opt/anqi/shared/business.env inventory.cjs after
code=$(curl -sS -o notify-check.json -w '%{http_code}' --resolve anqiht.okam.top:443:127.0.0.1 -X POST https://anqiht.okam.top/api/pay/notify -d '{}')
if [ "$code" = 401 ] || grep -q '微信支付未开通' notify-check.json; then echo "回调路由正常（HTTP $code）"; else echo "回调路由异常：HTTP $code" >&2; false; fi
sha256sum -c java-unchanged.sha256
systemctl is-active anqi-business anqi-backend anqi-mysql anqi-redis
touch published.ok
trap - ERR
echo '已发布 1.1.38：业务服务、H5 和后台已更新；Java 和所有设置未改动。下一步上传小程序 1.1.38。'

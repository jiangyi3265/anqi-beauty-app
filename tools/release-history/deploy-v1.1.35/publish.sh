#!/usr/bin/env bash
# 1.1.35：在已上线的 1.1.34 上更新业务服务、用户端 H5 和管理后台。
# 新增：体验卡可设置可选项目数/每项次数、贵宾卡未开通可浏览不可选、我的页面显示会员等级和待核销项目、
# 工作台今日营业额、分红记录当日营业额、签到默认 1 积分、推荐奖励可设“推荐人须办卡”。
# Java 程序、数据库结构、推荐奖励和分红池设置在本脚本中均不改动（签到积分、分红池、体验卡项目、推荐人须办卡由 post-config.cjs 单独调整）。
set -euo pipefail
umask 077
release=/opt/anqi/releases/20261022-v1.1.35
cd "$release"
test ! -e published.ok
sha256sum -c release.sha256
rm -rf stage && mkdir stage
tar -xzf release.tgz -C stage
for f in stage/business/server/*.cjs stage/business/tools/*.cjs inventory.cjs post-config.cjs; do /opt/anqi/node/bin/node --check "$f"; done
test -s stage/frontend/index.html && test -s stage/admin/index.html
grep -q '"version": "1.1.35"' stage/business/package.json
# 服务端还读取 common/ 下两份目录文件；本版未改动，核对线上与包内一致
for f in trial-catalogue.json vip-catalogue.json; do cmp -s "stage/business/common/$f" "/opt/anqi/business/common/$f" || { echo "线上 common/$f 与本包不一致，停止发布" >&2; exit 1; }; done
# 本包基于线上 1.1.34，版本不符时停止
/opt/anqi/node/bin/node -e 'const v=require("/opt/anqi/business/package.json").version;if(v!=="1.1.34")throw Error("线上业务服务是 "+v+"，本包要求基线 1.1.34")'
/opt/anqi/node/bin/node - <<'NODE'
const assert=require('assert/strict');
const old=require('/opt/anqi/business/package-lock.json'), next=require('./stage/business/package-lock.json');
delete old.packages[''];delete next.packages[''];
assert.deepEqual(next.packages,old.packages,'依赖发生变化，需先准备依赖');
NODE
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
tar -xzf /opt/anqi/releases/20261022-v1.1.35/before-code-sites.tgz --exclude='*/.user.ini' -C /
result=$?
systemctl start anqi-business
echo '已恢复 1.1.34 的业务代码、H5 和后台；业务数据保留。'
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
/opt/anqi/node/bin/node -e 'const b=require(process.argv[1]);if(b.config.version!=="1.1.35")throw Error("业务服务版本不是 1.1.35");if(b.config.trialUses!==1||b.config.trialPick==null)throw Error("体验卡新设置未生效")' "$release/bootstrap.json"
/opt/anqi/node/bin/node --env-file=/opt/anqi/shared/business.env inventory.cjs after
code=$(curl -sS -o notify-check.json -w '%{http_code}' --resolve anqiht.okam.top:443:127.0.0.1 -X POST https://anqiht.okam.top/api/pay/notify -d '{}')
if [ "$code" = 401 ] || grep -q '微信支付未开通' notify-check.json; then echo "回调路由正常（HTTP $code）"; else echo "回调路由异常：HTTP $code" >&2; false; fi
sha256sum -c java-unchanged.sha256
systemctl is-active anqi-business anqi-backend anqi-mysql anqi-redis
touch published.ok
trap - ERR
echo '已发布 1.1.35：业务服务、H5 和后台已更新；Java 未改动。下一步运行 post-config.cjs。'

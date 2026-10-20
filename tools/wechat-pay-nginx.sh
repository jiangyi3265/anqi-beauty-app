#!/usr/bin/env bash
# 给 anqiht.okam.top 增加微信支付回调规则：/api/pay/notify 直接转给本机业务服务（其余 /api/ 仍经 Java）。
# 回调需要原样的请求内容和 Wechatpay-* 签名头，业务服务自行验签；该地址不经过 Java，Java 也不对外开放它。
# 可重复执行：已存在则跳过；修改前备份，nginx -t 失败自动恢复。
set -euo pipefail
conf=/www/server/panel/vhost/nginx/anqiht.okam.top.conf
port=$(grep -E '^PORT=' /opt/anqi/shared/business.env 2>/dev/null | tail -1 | cut -d= -f2 | tr -d '"' || true)
port=${port:-3016}
[[ "$port" =~ ^[0-9]+$ ]] || { echo "业务服务端口无效：$port" >&2; exit 1; }
if grep -q 'location = /api/pay/notify' "$conf"; then echo '微信支付回调规则已存在，跳过'; exit 0; fi
backup="$conf.before-wechat-pay.$(date +%Y%m%d%H%M%S)"
cp -p "$conf" "$backup"
python3 - "$conf" "$port" <<'PY'
import sys
conf, port = sys.argv[1], sys.argv[2]
s = open(conf, encoding='utf-8').read()
anchor = ' location ^~ /api/ {'
assert s.count(anchor) == 1, '未找到唯一的 /api/ 规则，请人工检查 nginx 配置'
rule = (' location = /api/pay/notify {\n'
        '   proxy_pass http://127.0.0.1:' + port + ';\n'
        '   proxy_set_header Host $host;\n'
        '   proxy_set_header X-Real-IP $remote_addr;\n'
        '   proxy_set_header X-Forwarded-For $remote_addr;\n'
        '   proxy_set_header X-Forwarded-Proto https;\n'
        '   proxy_read_timeout 30s;\n'
        '   client_max_body_size 64k;\n'
        ' }\n')
open(conf, 'w', encoding='utf-8').write(s.replace(anchor, rule + anchor))
PY
if /www/server/nginx/sbin/nginx -t; then /www/server/nginx/sbin/nginx -s reload; echo "已添加微信支付回调规则（备份：$backup）"; else cp -p "$backup" "$conf"; echo 'nginx 配置检查未通过，已恢复原配置' >&2; exit 1; fi

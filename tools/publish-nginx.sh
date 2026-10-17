set -eu
test -f /etc/letsencrypt/live/anqi-beauty/fullchain.pem
python3 - <<'PY'
from pathlib import Path
for host in ['anqi.okam.top','anqiht.okam.top']:
 root='/www/wwwroot/'+host
 s='''server {
 listen 80;
 listen [::]:80;
 server_name HOST;
 root ROOT;
 location ^~ /.well-known/acme-challenge/ { allow all; }
 location / { return 301 https://$host$request_uri; }
}
server {
 listen 443 ssl;
 listen [::]:443 ssl;
 server_name HOST;
 root ROOT;
 index index.html;
 ssl_certificate /etc/letsencrypt/live/anqi-beauty/fullchain.pem;
 ssl_certificate_key /etc/letsencrypt/live/anqi-beauty/privkey.pem;
 ssl_protocols TLSv1.2 TLSv1.3;
 ssl_session_cache shared:ANQISSL:5m;
 client_max_body_size 8m;
 add_header X-Content-Type-Options nosniff always;
 add_header Referrer-Policy strict-origin-when-cross-origin always;
 location ^~ /.well-known/acme-challenge/ { allow all; }
 location ^~ /api/ {
   proxy_pass http://127.0.0.1:8097;
   proxy_set_header Host $host;
   proxy_set_header X-Real-IP $remote_addr;
   proxy_set_header X-Forwarded-For $remote_addr;
   proxy_set_header X-Forwarded-Proto https;
   proxy_read_timeout 40s;
   add_header Cache-Control no-store always;
 }
 location ^~ /static/uploads/ { alias /opt/anqi/business/static/uploads/; expires 1d; }
 location ~ /\\. { deny all; }
 location = /index.html { add_header Cache-Control no-cache always; }
 location / { try_files $uri $uri/ /index.html; }
 access_log /www/wwwlogs/HOST.log;
 error_log /www/wwwlogs/HOST.error.log;
 EXTRA
}
'''
 extra=''
 if host=='anqiht.okam.top':
  extra='''location ^~ /prod-api/ {
 proxy_pass http://127.0.0.1:8097/;
 proxy_set_header Host $host;
 proxy_set_header X-Real-IP $remote_addr;
 proxy_set_header X-Forwarded-For $remote_addr;
 proxy_set_header X-Forwarded-Proto https;
 proxy_read_timeout 40s;
 }
 location ^~ /static/assets/ { alias /www/wwwroot/anqi.okam.top/static/assets/; }
 location ^~ /static/reference/ { alias /www/wwwroot/anqi.okam.top/static/reference/; }
 location ^~ /static/brand/ { alias /www/wwwroot/anqi.okam.top/static/brand/; }
 location ^~ /profile/ { alias /opt/anqi/shared/profile/; }
 '''
 Path('/www/server/panel/vhost/nginx/'+host+'.conf').write_text(s.replace('HOST',host).replace('ROOT',root).replace('EXTRA',extra))
PY
/www/server/nginx/sbin/nginx -t
/www/server/nginx/sbin/nginx -s reload
mkdir -p /etc/letsencrypt/renewal-hooks/deploy
printf '#!/bin/sh\n/www/server/nginx/sbin/nginx -t && /www/server/nginx/sbin/nginx -s reload\n' > /etc/letsencrypt/renewal-hooks/deploy/anqi-nginx.sh
chmod 750 /etc/letsencrypt/renewal-hooks/deploy/anqi-nginx.sh
echo 'Both Anqi domains published with HTTPS'

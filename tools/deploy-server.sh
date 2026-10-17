set -eu
umask 027
cd /opt/anqi
tar -xzf source/business.tgz -C business
tar -xzf source/frontend.tgz -C /www/wwwroot/anqi.okam.top
tar -xzf source/admin.tgz -C /www/wwwroot/anqiht.okam.top
find /www/wwwroot/anqi.okam.top /www/wwwroot/anqiht.okam.top ! -name '.user.ini' -exec chmod a+rX {} +
mkdir -p business/static/uploads shared/profile
chown -R anqi:anqi business ruoyi shared/profile
chmod 751 /opt/anqi /opt/anqi/business /opt/anqi/shared
chmod 755 business/static business/static/uploads shared/profile
export PATH=/opt/anqi/node/bin:$PATH
cd /opt/anqi/business
npm install --omit=dev --no-audit --no-fund > /opt/anqi/logs/npm-install.log 2>&1
chown -R anqi:anqi /opt/anqi/business/node_modules
cd /opt/anqi
python3 - <<'PY'
import json,subprocess,os
c=json.load(open('/opt/anqi/shared/credentials.json'));env=dict(os.environ,MYSQL_PWD=c['dbPassword']);cmd=['mysql','-h127.0.0.1','-P3309','-u'+c['dbUser'],'--default-character-set=utf8mb4','anqi_beauty']
r=subprocess.run(cmd+['-N','-e',"SHOW TABLES LIKE 'sys_user'"],env=env,check=True,capture_output=True,text=True)
if not r.stdout.strip():
 for f in ['/opt/anqi/source/ruoyi/sql/ry_20250522.sql','/opt/anqi/source/ruoyi/sql/anqi-deployment-menus.sql']:
  subprocess.run(cmd,input=open(f).read(),env=env,text=True,check=True,stdout=subprocess.DEVNULL)
 pw=open('/opt/anqi/shared/admin-hash').read().strip()
 q="UPDATE sys_user SET password='"+pw+"',nick_name='暨美丽管理员',email='',phonenumber='' WHERE user_id=1; UPDATE sys_config SET config_value='"+c['adminPassword']+"' WHERE config_key='sys.user.initPassword';"
 subprocess.run(cmd+['-e',q],env=env,check=True)
 print('RuoYi schema, administrator, and 17 business menus initialized')
PY
cat > /etc/systemd/system/anqi-redis.service <<'EOF'
[Unit]
Description=Anqi dedicated Redis
After=network.target
[Service]
User=anqi
Group=anqi
ExecStart=/www/server/redis/src/redis-server /opt/anqi/redis/redis.conf
Restart=on-failure
RestartSec=5
[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/anqi-business.service <<'EOF'
[Unit]
Description=Anqi transactional business service
After=network.target anqi-mysql.service
Requires=anqi-mysql.service
[Service]
User=anqi
Group=anqi
WorkingDirectory=/opt/anqi/business
EnvironmentFile=/opt/anqi/shared/business.env
ExecStart=/opt/anqi/node/bin/node --max-old-space-size=192 server/index.cjs
Restart=on-failure
RestartSec=5
UMask=0022
NoNewPrivileges=true
[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/anqi-backend.service <<'EOF'
[Unit]
Description=Anqi RuoYi API and administration
After=network.target anqi-mysql.service anqi-redis.service anqi-business.service
Requires=anqi-mysql.service anqi-redis.service
[Service]
User=anqi
Group=anqi
WorkingDirectory=/opt/anqi/ruoyi
ExecStart=/usr/bin/java -Dlogback.configurationFile=/opt/anqi/shared/logback.xml -Xms96m -Xmx384m -XX:MaxMetaspaceSize=192m -jar /opt/anqi/ruoyi/ruoyi-admin.jar --spring.config.additional-location=file:/opt/anqi/shared/application-production.properties
Restart=on-failure
RestartSec=8
UMask=0022
NoNewPrivileges=true
[Install]
WantedBy=multi-user.target
EOF
if ! test -f source/ruoyi/ruoyi-admin/target/ruoyi-admin.jar; then echo 'Java build is not ready yet'; exit 2; fi
cp source/ruoyi/ruoyi-admin/target/ruoyi-admin.jar ruoyi/ruoyi-admin.jar
chown anqi:anqi ruoyi/ruoyi-admin.jar
systemctl daemon-reload
systemctl enable --now anqi-redis anqi-business anqi-backend
echo 'Anqi services started'

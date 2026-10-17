set -eu
umask 027
test ! -e /opt/anqi/shared/credentials.json || { echo 'Anqi is already initialized'; exit 0; }
mkdir -p /opt/anqi/{shared,backups,source,business,ruoyi,redis,logs}
id anqi >/dev/null 2>&1 || useradd --system --home-dir /opt/anqi --shell /sbin/nologin anqi
tar -czf /opt/anqi/backups/initial-sites.tgz /www/wwwroot/anqi.okam.top /www/wwwroot/anqiht.okam.top /www/server/panel/vhost/nginx/anqi.okam.top.conf /www/server/panel/vhost/nginx/anqiht.okam.top.conf 2>/dev/null
python3 - <<'PY'
import sqlite3,subprocess,os,json,secrets,crypt
root='' 
env=dict(os.environ,MYSQL_PWD=root)
def sql(s):return subprocess.run(['mysql','--socket=/opt/anqi/mysql-data/mysql.sock','-uroot','--default-character-set=utf8mb4','-N','-e',s],env=env,check=True,capture_output=True).stdout.decode()
if sql("SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='anqi_beauty'").strip():raise Exception('Refusing to replace existing database')
cfg={k:secrets.token_urlsafe(24) for k in ['dbPassword','redisPassword','internalSecret','jwtSecret','adminPassword']}
cfg.update(dbName='anqi_beauty',dbUser='anqi_beauty',adminUser='admin',dbPort=3309,mysqlRoot=secrets.token_urlsafe(32))
sql("CREATE DATABASE anqi_beauty CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE USER 'anqi_beauty'@'127.0.0.1' IDENTIFIED BY '"+cfg['dbPassword']+"'; GRANT ALL ON anqi_beauty.* TO 'anqi_beauty'@'127.0.0.1';")
sql("ALTER USER 'root'@'localhost' IDENTIFIED BY '"+cfg['mysqlRoot']+"';")
open('/opt/anqi/shared/credentials.json','w').write(json.dumps(cfg));os.chmod('/opt/anqi/shared/credentials.json',0o600)
open('/opt/anqi/shared/admin-hash','w').write(crypt.crypt(cfg['adminPassword'],crypt.mksalt(crypt.METHOD_BLOWFISH)))
open('/opt/anqi/shared/business.env','w').write('\n'.join(['NODE_ENV=production','HOST=127.0.0.1','PORT=3016','DEMO_MODE=false','PUBLIC_ORIGIN=https://anqi.okam.top','ADMIN_PASSWORD='+secrets.token_urlsafe(40),'INTERNAL_SECRET='+cfg['internalSecret'],'DB_PORT=3309','DB_NAME='+cfg['dbName'],'DB_USER='+cfg['dbUser'],'DB_PASSWORD='+cfg['dbPassword'],'PAYMENT_MODE=off'])+'\n')
props={'server.address':'127.0.0.1','server.port':'8097','spring.datasource.druid.master.url':'jdbc:mysql://127.0.0.1:3309/anqi_beauty?useUnicode=true&characterEncoding=utf8&useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=Asia/Shanghai','spring.datasource.druid.master.username':cfg['dbUser'],'spring.datasource.druid.master.password':cfg['dbPassword'],'spring.datasource.druid.initialSize':'1','spring.datasource.druid.minIdle':'1','spring.datasource.druid.maxActive':'5','spring.datasource.druid.statViewServlet.enabled':'false','spring.datasource.druid.webStatFilter.enabled':'false','spring.redis.host':'127.0.0.1','spring.redis.port':'16382','spring.redis.password':cfg['redisPassword'],'spring.redis.database':'0','ruoyi.profile':'/opt/anqi/shared/profile','ruoyi.name':'Anqi Beauty','ruoyi.addressEnabled':'false','token.secret':cfg['jwtSecret'],'token.expireTime':'120','anqi.internal-secret':cfg['internalSecret'],'anqi.business-url':'http://127.0.0.1:3016','swagger.enabled':'false','spring.devtools.restart.enabled':'false','server.tomcat.threads.max':'60','server.tomcat.threads.min-spare':'5','logging.level.com.ruoyi':'info','logging.file.name':'/opt/anqi/logs/backend.log'}
open('/opt/anqi/shared/application-production.properties','w').write('\n'.join(k+'='+v for k,v in props.items())+'\n')
open('/opt/anqi/redis/redis.conf','w').write('bind 127.0.0.1\nport 16382\nprotected-mode yes\nrequirepass '+cfg['redisPassword']+'\nmaxmemory 48mb\nmaxmemory-policy allkeys-lru\nappendonly yes\ndir /opt/anqi/redis\ndaemonize no\n')
print('Created dedicated Anqi database and private service configuration')
PY
if ! test -x /opt/anqi/node/bin/node; then
 cd /opt/anqi
 curl -fsS --retry 3 https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt -o node-checksums.txt
 NODE_TAR=$(awk '/linux-x64.tar.xz$/ {print $2;exit}' node-checksums.txt)
 curl -fsS --retry 3 "https://nodejs.org/dist/latest-v24.x/$NODE_TAR" -o "$NODE_TAR"
 grep " $NODE_TAR$" node-checksums.txt | sha256sum -c -
 mkdir node
 tar -xJf "$NODE_TAR" -C node --strip-components=1
fi
chown -R anqi:anqi /opt/anqi/business /opt/anqi/redis /opt/anqi/logs
chgrp anqi /opt/anqi/shared/business.env /opt/anqi/shared/application-production.properties
chmod 640 /opt/anqi/shared/business.env /opt/anqi/shared/application-production.properties
echo 'Dedicated runtime ready'



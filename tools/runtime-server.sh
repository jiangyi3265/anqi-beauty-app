set -eu
cd /opt/anqi
if ! test -x node/bin/node; then
 curl -fsS --retry 3 https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt -o node-checksums.txt
 NODE_TAR=$(awk '/linux-x64.tar.xz$/ {print $2;exit}' node-checksums.txt)
 curl -fsS --retry 3 "https://nodejs.org/dist/latest-v24.x/$NODE_TAR" -o "$NODE_TAR"
 grep " $NODE_TAR$" node-checksums.txt | sha256sum -c -
 mkdir -p node
 tar -xJf "$NODE_TAR" -C node --strip-components=1
fi
chown -R anqi:anqi /opt/anqi/business /opt/anqi/redis /opt/anqi/logs
chgrp anqi /opt/anqi/shared/business.env /opt/anqi/shared/application-production.properties
chmod 640 /opt/anqi/shared/business.env /opt/anqi/shared/application-production.properties
node/bin/node --version
tail -15 /opt/anqi/logs/build.log
certbot certonly --webroot -w /www/wwwroot/anqi.okam.top -d anqi.okam.top -w /www/wwwroot/anqiht.okam.top -d anqiht.okam.top --cert-name anqi-beauty --non-interactive --agree-tos --register-unsafely-without-email

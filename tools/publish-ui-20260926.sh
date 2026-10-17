set -eu
umask 027
release=/opt/anqi/releases/20260926-ui-images
site=/www/wwwroot/anqi.okam.top
test -d "$site"
test -f "$release/frontend.tgz"
test ! -f "$release/published"
tar -tzf "$release/frontend.tgz" > "$release/package-files.txt"
if grep -E '(^/|(^|/)\.\.(/|$))' "$release/package-files.txt"; then exit 2; fi
test ! -e "$release/previous-h5.tgz"
tar -czf "$release/previous-h5.tgz" -C "$site" .
systemctl start anqi-backup.service
systemctl is-failed anqi-backup.service && exit 3
mkdir -p "$release/staging"
tar -xzf "$release/frontend.tgz" -C "$release/staging"
test -f "$release/staging/index.html"
cp -a "$release/staging/assets/." "$site/assets/"
cp -a "$release/staging/static/." "$site/static/"
mkdir -p /opt/anqi/business/static/brand
cp "$release/staging/static/brand/product-closeup.jpg" "$release/staging/static/brand/284c27d5c43001f0f7f0ba76dcd24623.jpg" /opt/anqi/business/static/brand/
chmod 755 /opt/anqi/business/static/brand
chmod 644 /opt/anqi/business/static/brand/product-closeup.jpg /opt/anqi/business/static/brand/284c27d5c43001f0f7f0ba76dcd24623.jpg
find "$site/assets" "$site/static" -type d -exec chmod 755 {} +
find "$site/assets" "$site/static" -type f -exec chmod 644 {} +
cp "$release/staging/index.html" "$site/index.html.next"
chmod 644 "$site/index.html.next"
mv "$site/index.html.next" "$site/index.html"
if ! /opt/anqi/node/bin/node "$release/release-catalogue.cjs"; then
 tar -xzf "$release/previous-h5.tgz" -C "$site"
 exit 4
fi
date -u +%Y-%m-%dT%H:%M:%SZ > "$release/published"
sha256sum "$site/index.html" "$site/static/brand/product-closeup.jpg" "$site/static/brand/284c27d5c43001f0f7f0ba76dcd24623.jpg"
systemctl is-active anqi-business anqi-backend anqi-mysql anqi-redis
curl -fsS https://anqiht.okam.top/api/health

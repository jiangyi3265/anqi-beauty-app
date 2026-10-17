set -eu
umask 027
release=/opt/anqi/releases/20260926-ui-hero
site=/www/wwwroot/anqi.okam.top
rollback(){ if test -f "$release/previous-h5.tgz"; then tar -xzf "$release/previous-h5.tgz" -C "$site"; fi; }
trap rollback ERR
test -d "$site"
test ! -f "$release/published"
test ! -e "$release/previous-h5.tgz"
tar -tzf "$release/frontend-hero.tgz" > "$release/package-files.txt"
if grep -E '(^/|(^|/)\.\.(/|$))' "$release/package-files.txt"; then exit 2; fi
tar -czf "$release/previous-h5.tgz" -C "$site" .
systemctl start anqi-backup.service
systemctl is-failed anqi-backup.service && exit 3
mkdir -p "$release/staging"
tar -xzf "$release/frontend-hero.tgz" -C "$release/staging"
test -f "$release/staging/index.html"
test -f "$release/staging/static/brand/hero-jimeili.jpg"
cp -a "$release/staging/assets/." "$site/assets/"
cp -a "$release/staging/static/." "$site/static/"
find "$site/assets" "$site/static" -type d -exec chmod 755 {} +
find "$site/assets" "$site/static" -type f -exec chmod 644 {} +
cp "$release/staging/index.html" "$site/index.html.next"
chmod 644 "$site/index.html.next"
mv "$site/index.html.next" "$site/index.html"
/opt/anqi/node/bin/node "$release/update-hero.cjs"
date -u +%Y-%m-%dT%H:%M:%SZ > "$release/published"
trap - ERR
sha256sum "$site/index.html" "$site/static/brand/hero-jimeili.jpg"
systemctl is-active anqi-business anqi-backend anqi-mysql anqi-redis
curl -fsS https://anqiht.okam.top/api/health

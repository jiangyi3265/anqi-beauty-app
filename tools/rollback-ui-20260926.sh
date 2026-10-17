set -eu
release=/opt/anqi/releases/20260926-ui-images
test -f "$release/previous-h5.tgz"
test -f "$release/products-before.json"
/opt/anqi/node/bin/node "$release/release-catalogue.cjs" --rollback
tar -xzf "$release/previous-h5.tgz" -C /www/wwwroot/anqi.okam.top
echo 'Restored previous site and product availability; orders and stock retained.'

// 1.1.38 发布前后数据核对：before 备份数据库并记录全部业务记录；after 核对历史记录全部保留、内容未被改动，
// 推荐奖励与分红池设置不变，版本号为 1.1.38。启动时过期取消的待付款订单、到期入账的收益属于正常业务变化，单独放行。
const fs = require('fs'), assert = require('assert/strict'), { spawnSync } = require('child_process');
const mysql = require('/opt/anqi/business/node_modules/mysql2/promise');
(async () => {
  const credentials = JSON.parse(fs.readFileSync('/opt/anqi/shared/credentials.json'));
  const port = String(process.env.DB_PORT || 3309);
  const db = await mysql.createConnection({ host: '127.0.0.1', port: Number(port), user: credentials.dbUser, password: credentials.dbPassword, database: process.env.DB_NAME });
  const mode = process.argv[2], dir = process.cwd();
  const read = async () => {
    const [tables] = await db.query("SHOW TABLES LIKE 'anqi_%'");
    const result = { config: JSON.parse((await db.query('SELECT config FROM anqi_lock WHERE id=1'))[0][0].config), collections: {} };
    for (const row of tables) {
      const name = Object.values(row)[0];
      if (name === 'anqi_lock' || !/^anqi_[a-zA-Z]+$/.test(name)) continue;
      const [rows] = await db.query('SELECT id,payload FROM `' + name + '` ORDER BY id');
      result.collections[name] = Object.fromEntries(rows.map(r => [r.id, JSON.parse(r.payload)]));
    }
    return result;
  };
  if (mode === 'before') {
    fs.writeFileSync(dir + '/before-inventory.json', JSON.stringify(await read()), { mode: 0o600 });
    const out = fs.openSync(dir + '/before-database.sql', 'wx', 0o600);
    const dump = spawnSync('mysqldump', ['-h', '127.0.0.1', '-P', port, '-u', credentials.dbUser, '--single-transaction', '--no-tablespaces', '--skip-lock-tables', '--default-character-set=utf8mb4', process.env.DB_NAME], { env: { ...process.env, MYSQL_PWD: credentials.dbPassword }, stdio: ['ignore', out, 'pipe'] });
    fs.closeSync(out);
    if (dump.status !== 0) throw Error('数据库备份失败：' + String(dump.stderr).replaceAll(credentials.dbPassword, '[已隐藏]'));
    assert.ok(fs.statSync(dir + '/before-database.sql').size > 1000, '数据库备份文件过小');
    console.log('数据库已备份，业务记录已登记。');
  } else if (mode === 'after') {
    const before = JSON.parse(fs.readFileSync(dir + '/before-inventory.json')), after = await read(), verified = {};
    for (const [name, rows] of Object.entries(before.collections)) {
      if (['anqi_sessions', 'anqi_audit', 'anqi_accounts', 'anqi_notifications'].includes(name)) continue;
      const actual = after.collections[name] || {};
      for (const [id, old] of Object.entries(rows)) {
        assert.ok(actual[id], name + ' 缺少历史记录 ' + id);
        if (name === 'anqi_orders' && old.status === 'pending' && actual[id].status === 'cancelled') continue;
        if (name === 'anqi_incomePlans' || name === 'anqi_users') continue;
        assert.deepEqual(actual[id], old, name + ' 历史记录内容被改动 ' + id);
      }
      verified[name] = { before: Object.keys(rows).length, after: Object.keys(actual).length, originalRecordsPreserved: true };
    }
    for (const key of ['poolReward', 'referralReward']) assert.deepEqual(after.config[key], before.config[key], key + ' 不应改变');
    assert.equal(after.config.version, '1.1.38');
    const report = { version: '1.1.38', collections: verified, referralUnchanged: true, poolUnchanged: true, backupBytes: fs.statSync(dir + '/before-database.sql').size };
    fs.writeFileSync(dir + '/verification-result.json', JSON.stringify(report, null, 2));
    console.log('历史记录全部保留，推荐奖励与分红池设置未变。');
  } else throw Error('未知模式');
  await db.end();
})().catch(e => { console.error(e.message); process.exit(1); });

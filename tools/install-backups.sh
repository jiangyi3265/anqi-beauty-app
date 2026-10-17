set -eu
mkdir -p /opt/anqi/backups
chmod 700 /opt/anqi/backups
cat > /opt/anqi/shared/backup.py <<'PY'
import json,subprocess,os,datetime,gzip,pathlib,tarfile
c=json.load(open('/opt/anqi/shared/credentials.json'));folder=pathlib.Path('/opt/anqi/backups');stamp=datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
env=dict(os.environ,MYSQL_PWD=c['dbPassword']);target=folder/('anqi-'+stamp+'.sql.gz')
p=subprocess.Popen(['/www/server/mysql/bin/mysqldump','-h127.0.0.1','-P3309','-u'+c['dbUser'],'--single-transaction','--no-tablespaces','--set-gtid-purged=OFF',c['dbName']],stdout=subprocess.PIPE,env=env)
with gzip.open(target,'wb') as out:
 while True:
  block=p.stdout.read(1024*1024)
  if not block:break
  out.write(block)
if p.wait()!=0:target.unlink();raise RuntimeError('MySQL backup failed')
os.chmod(target,0o600)
with tarfile.open(folder/('uploads-'+stamp+'.tgz'),'w:gz') as t:t.add('/opt/anqi/business/static/uploads',arcname='uploads')
for pattern in ['anqi-*.sql.gz','uploads-*.tgz']:
 for f in sorted(folder.glob(pattern))[:-7]:f.unlink()
print('Anqi database and uploaded assets backed up')
PY
chmod 700 /opt/anqi/shared/backup.py
cat > /etc/systemd/system/anqi-backup.service <<'EOF'
[Unit]
Description=Back up Anqi database and uploaded media
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 /opt/anqi/shared/backup.py
UMask=0077
EOF
cat > /etc/systemd/system/anqi-backup.timer <<'EOF'
[Unit]
Description=Daily Anqi backup
[Timer]
OnCalendar=*-*-* 03:20:00
Persistent=true
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now anqi-backup.timer
systemctl start anqi-backup.service
systemctl is-active anqi-mysql anqi-redis anqi-business anqi-backend
ls -lh /opt/anqi/backups

const {Client}=require('./remote-runtime/node_modules/ssh2');
const fs=require('node:fs');
const conn=new Client();
conn.on('ready',()=>{
 if(process.argv[2]==='get') conn.sftp((e,s)=>{if(e)throw e;s.fastGet(process.argv[3],process.argv[4],e=>{if(e)throw e;console.log('Downloaded requested file');conn.end()})});
 else if(process.argv[2]==='put') conn.sftp((e,s)=>{if(e)throw e;s.fastPut(process.argv[3],process.argv[4],e=>{if(e)throw e;console.log('Uploaded '+process.argv[4]);conn.end()})});
 else {const cmd=process.argv[2]==='file'?fs.readFileSync(process.argv[3],'utf8'):process.argv[2];conn.exec(cmd,(e,s)=>{if(e)throw e;s.on('data',d=>process.stdout.write(d));s.stderr.on('data',d=>process.stderr.write(d));s.on('close',code=>{conn.end();process.exitCode=code})})}
}).on('error',e=>{console.error(e.message);process.exitCode=1});
if (!process.env.ANQI_SSH_HOST || !process.env.ANQI_SSH_USER || !process.env.ANQI_SSH_PASSWORD) {
 throw new Error('Set ANQI_SSH_HOST, ANQI_SSH_USER and ANQI_SSH_PASSWORD in the local environment');
}
conn.connect({host:process.env.ANQI_SSH_HOST,username:process.env.ANQI_SSH_USER,password:process.env.ANQI_SSH_PASSWORD,readyTimeout:20000});

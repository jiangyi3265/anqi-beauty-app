set -eu
python3 - <<'PY'
import json,subprocess,os
c=json.load(open('/opt/anqi/shared/credentials.json'))
q="""
INSERT INTO sys_menu(menu_id,menu_name,parent_id,order_num,path,is_frame,is_cache,menu_type,visible,status,icon,create_by,create_time)
VALUES(3200,'礼品管理',0,2,'gifts',1,1,'M','0','0','gift','admin',NOW()),(3201,'店铺设置',0,3,'shop',1,1,'M','0','0','edit','admin',NOW())
ON DUPLICATE KEY UPDATE menu_name=VALUES(menu_name),path=VALUES(path);
UPDATE sys_menu SET menu_name='日常业务',order_num=1,icon='shopping' WHERE menu_id=3000;
INSERT INTO sys_menu(menu_id,menu_name,parent_id,order_num,path,component,is_frame,is_cache,menu_type,visible,status,icon,perms,create_by,create_time) VALUES(3018,'商城分类',3000,2,'categories','anqi/categories/index',1,0,'C','0','0','list','anqi:categories:list','admin',NOW()) ON DUPLICATE KEY UPDATE menu_name=VALUES(menu_name),parent_id=VALUES(parent_id),path=VALUES(path),component=VALUES(component),perms=VALUES(perms);
INSERT INTO sys_menu(menu_id,menu_name,parent_id,order_num,path,is_frame,is_cache,menu_type,visible,status,perms,create_by,create_time) VALUES(3118,'管理商城分类',3018,1,'#',1,1,'F','0','0','anqi:categories:edit','admin',NOW()) ON DUPLICATE KEY UPDATE menu_name=VALUES(menu_name),parent_id=VALUES(parent_id),perms=VALUES(perms);
UPDATE sys_menu SET parent_id=3200 WHERE menu_id IN(3011);
UPDATE sys_menu SET parent_id=3201 WHERE menu_id IN(3012,3013,3016);
UPDATE sys_menu SET visible='1' WHERE menu_id IN(3001,3007,3015,3017);
UPDATE sys_menu SET order_num=1 WHERE menu_id IN(3005,3009,3012);
UPDATE sys_menu SET order_num=2 WHERE menu_id IN(3006,3010,3013);
UPDATE sys_menu SET order_num=3 WHERE menu_id IN(3002,3011,3016);
UPDATE sys_menu SET order_num=4 WHERE menu_id IN(3004,3008);
UPDATE sys_menu SET order_num=5 WHERE menu_id=3003;
UPDATE sys_menu SET order_num=6 WHERE menu_id=3014;
UPDATE sys_menu SET menu_name='会员邀请' WHERE menu_id=3014;
UPDATE sys_menu SET menu_name='合作商家' WHERE menu_id=3013;
"""
subprocess.run(['mysql','-h127.0.0.1','-P3309','-u'+c['dbUser'],'--default-character-set=utf8mb4','anqi_beauty','-e',q],env=dict(os.environ,MYSQL_PWD=c['dbPassword']),check=True)
print('Simplified business menus configured')
PY


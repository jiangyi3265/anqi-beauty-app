const crypto = require('node:crypto');

function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
const text = (v, max = 100) => typeof v === 'string' ? v.trim().slice(0, max) : '';
function validDate(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v; }
function minutes(v) { if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) fail('时间格式应为 HH:mm'); return Number(v.slice(0, 2)) * 60 + Number(v.slice(3)); }
const overlaps = (a, b, c, d) => a < d && c < b;
const timestamp = (date, time) => Date.parse(date + 'T' + time + ':00+08:00');
function duration(store) { return Number(store.appointmentDurationMinutes || 60); }
function interval(a) { const start = minutes(a.time); return [start, start + Number(a.durationMinutes || 60)]; }
function initialize(db) { db.staff ||= []; db.shifts ||= []; }

function covered(db, staffId, storeId, date, start, end) {
  if (!db.staff.some(s => s.id === staffId && s.enabled !== false)) return false;
  const shifts = db.shifts.filter(s => s.staffId === staffId && s.date === date);
  if (shifts.some(s => s.status === 'leave' && overlaps(start, end, minutes(s.startTime), minutes(s.endTime)))) return false;
  return shifts.some(s => s.status === 'working' && s.storeId === storeId && minutes(s.startTime) <= start && minutes(s.endTime) >= end);
}

function available(db, store, date, time, now = Date.now()) {
  initialize(db);
  const start = minutes(time), end = start + duration(store);
  if (end > 1440 || timestamp(date, time) <= now) return { time, remaining: 0, staff: [] };
  const busy = db.appointments.filter(a => a.status === 'booked' && a.date === date && overlaps(start, end, ...interval(a)));
  const remaining = Math.max(0, Number(db.config.appointmentCapacity || 1) - busy.filter(a => a.storeId === store.id).length);
  if (!store.schedulingEnabled) return { time, remaining, staff: [] };
  // A legacy, unassigned booking still occupies the store. Do not silently assign
  // its staff or allow a new booking to consume the same employee's time.
  const unassigned = busy.some(a => a.storeId === store.id && !a.staffId);
  const staff = unassigned ? [] : db.staff.filter(s => covered(db, s.id, store.id, date, start, end) && !busy.some(a => a.staffId === s.id))
    .sort((a, b) => db.appointments.filter(r => r.status === 'booked' && r.date === date && r.staffId === a.id).length - db.appointments.filter(r => r.status === 'booked' && r.date === date && r.staffId === b.id).length || a.id.localeCompare(b.id))
    .map(s => ({ id: s.id, name: s.name }));
  return { time, remaining: Math.min(remaining, staff.length), staff: remaining ? staff : [] };
}

function options(db, store, date) {
  if (!validDate(date)) fail('请选择有效预约日期');
  const times = String(db.config.appointmentTimes).split(',').map(s => s.trim()).filter(Boolean);
  return { scheduled: store.schedulingEnabled === true, durationMinutes: duration(store), slots: times.map(time => available(db, store, date, time)) };
}

function reserve(db, store, b) {
  if (!validDate(b.date) || !String(db.config.appointmentTimes).split(',').map(s => s.trim()).includes(b.time)) fail('请选择有效预约日期和时间');
  if (timestamp(b.date, b.time) <= Date.now()) fail('该预约时间已过，请选择之后的时段');
  const slot = available(db, store, b.date, b.time);
  if (!slot.remaining) fail(store.schedulingEnabled ? '该时段无可用员工或预约名额已满，请重新选择' : '该时间段预约名额已满');
  const result = { durationMinutes: duration(store) };
  if (store.schedulingEnabled) {
    const staff = b.staffId ? slot.staff.find(s => s.id === b.staffId) : slot.staff[0];
    if (!staff) fail('该员工在此时段不可预约，请重新选择');
    Object.assign(result, { staffId: staff.id, staff: { ...staff } });
  } else if (b.staffId) fail('该门店尚未启用员工排班');
  return result;
}

function protectAppointments(db) {
  for (const a of db.appointments) {
    if (a.status !== 'booked' || !a.staffId || timestamp(a.date, a.time) + Number(a.durationMinutes || 60) * 60000 <= Date.now()) continue;
    if (!covered(db, a.staffId, a.storeId, a.date, ...interval(a))) fail('此修改会影响已有预约，请先在预约管理中处理相关预约');
  }
}

function staffRecord(b) {
  if (!text(b.name, 40)) fail('请填写员工姓名');
  if (b.enabled !== undefined && typeof b.enabled !== 'boolean') fail('员工状态无效');
  const phone = text(b.phone, 30);
  if (phone && !/^1\d{10}$/.test(phone)) fail('员工手机号须为11位');
  return { name: text(b.name, 40), title: text(b.title, 40), phone, enabled: b.enabled !== false };
}

function shiftRecord(db, b, id) {
  if (!db.staff.some(s => s.id === b.staffId && s.enabled !== false)) fail('请选择在职员工');
  if (!db.stores.some(s => s.id === b.storeId && s.enabled !== false)) fail('请选择营业中的门店');
  if (!validDate(b.date)) fail('请选择有效排班日期');
  const start = minutes(b.startTime), end = minutes(b.endTime);
  if (end <= start) fail('结束时间必须晚于开始时间；跨天班次请分两天录入');
  if (!['working', 'leave'].includes(b.status)) fail('请选择出勤或休假');
  if (timestamp(b.date, b.endTime) <= Date.now()) fail('不能新增或修改已经结束的班次');
  if (db.shifts.some(s => s.id !== id && s.staffId === b.staffId && s.date === b.date && overlaps(start, end, minutes(s.startTime), minutes(s.endTime)))) fail('该员工已有重叠班次或休假，跨门店也不能重复排班');
  return { staffId: b.staffId, storeId: b.storeId, date: b.date, startTime: b.startTime, endTime: b.endTime, status: b.status, note: text(b.note, 300) };
}

function manage(db, resource, key, method, body) {
  initialize(db);
  if (method === 'GET') return db[resource];
  if (method === 'POST' && resource === 'shifts' && key === 'batch') {
    if (!Array.isArray(body.dates) || !body.dates.length || body.dates.length > 31 || new Set(body.dates).size !== body.dates.length) fail('批量排班请选择1至31个不同日期');
    const rows = body.dates.map(date => ({ ...shiftRecord(db, { ...body, date }), id: crypto.randomUUID(), createdAt: new Date().toISOString() }));
    db.shifts.push(...rows); protectAppointments(db); return rows;
  }
  if (method === 'POST' && !key) {
    const row = { ...(resource === 'staff' ? staffRecord(body) : shiftRecord(db, body)), id: crypto.randomUUID(), createdAt: new Date().toISOString() };
    db[resource].push(row); protectAppointments(db); return row;
  }
  const row = db[resource].find(s => s.id === key);
  if (!row) fail('记录不存在', 404);
  if (method === 'PUT') {
    if (resource === 'shifts' && timestamp(row.date, row.endTime) <= Date.now()) fail('已经结束的班次不可修改');
    Object.assign(row, resource === 'staff' ? staffRecord({ ...row, ...body }) : shiftRecord(db, { ...row, ...body }, key));
  } else if (method === 'DELETE' && resource === 'shifts') {
    if (timestamp(row.date, row.endTime) <= Date.now()) fail('已经结束的班次不可删除');
    db.shifts = db.shifts.filter(s => s.id !== key);
  } else fail('操作不支持，员工离职请使用停用', 405);
  protectAppointments(db);
  return row;
}

module.exports = { initialize, options, reserve, manage, validDate };

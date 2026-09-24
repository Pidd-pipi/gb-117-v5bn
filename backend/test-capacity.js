// 并发/容量集成测试：使用内存 MongoDB + 真实 Express HTTP
const assert = require('assert');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const express = require('express');

process.env.JWT_OVERRIDE = '1';

(async () => {
  const mongod = await MongoMemoryServer.create({
    binary: { version: '7.0.14', os: 'linux', distro: 'ubuntu-22.04' }
  });
  const uri = mongod.getUri('anime-expo-test');

  const app = express();
  app.use(express.json());
  await mongoose.connect(uri);

  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/expos', require('./routes/expos'));
  app.use('/api/booths', require('./routes/booths'));

  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/api`;

  const { JWT_SECRET } = require('./middleware/auth');
  const User = require('./models/User');
  const Expo = require('./models/Expo');
  const Booth = require('./models/Booth');

  // 准备用户
  const admin = await User.create({ username: 'admin1', email: 'a@x.com', password: 'p', role: 'admin' });
  const admin2 = await User.create({ username: 'admin2', email: 'b@x.com', password: 'p', role: 'admin' });
  const owner = await User.create({ username: 'owner1', email: 'o@x.com', password: 'p', role: 'vendor' });
  const token = u => jwt.sign({ userId: u._id.toString() }, JWT_SECRET);
  const t1 = token(admin);
  const t2 = token(admin2);

  // 创建展会 + 容量为 2 的分区
  const expo = await Expo.create({
    name: '测试展', description: 'd', startDate: new Date(), endDate: new Date(), createdBy: owner._id
  });
  const createZoneRes = await fetch(`${base}/expos/${expo._id}/zones`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${t1}` },
    body: JSON.stringify({ name: '同人区', capacity: 2, color: '#f00' })
  });
  assert.strictEqual(createZoneRes.status, 200, '创建分区应成功');
  let expoDoc = await Expo.findById(expo._id);
  const zone = expoDoc.zones[0];
  assert.strictEqual(zone.capacity, 2);

  // 缺容量/非法容量
  const bad1 = await fetch(`${base}/expos/${expo._id}/zones`, {
    method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${t1}` },
    body: JSON.stringify({ name: '无容量区' })
  });
  assert.strictEqual(bad1.status, 400, '无容量应拒绝');
  const bad2 = await fetch(`${base}/expos/${expo._id}/zones`, {
    method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${t1}` },
    body: JSON.stringify({ name: '零容量区', capacity: 0 })
  });
  assert.strictEqual(bad2.status, 400, '容量0应拒绝');

  // 3 个摊主各申请一个摊位
  const booths = [];
  for (let i = 0; i < 3; i++) {
    const v = await User.create({ username: `v${i}`, email: `v${i}@x.com`, password: 'p', role: 'vendor' });
    const booth = await Booth.create({
      name: `摊位${i}`, description: 'd', expoId: expo._id, ownerId: v._id, zoneName: '同人区'
    });
    booths.push(booth);
  }

  // 两个管理员同时通过 3 个申请（容量 2）
  const approve = (boothId, tok, zoneId = zone._id.toString()) => fetch(`${base}/booths/${boothId}/approve`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${tok}` },
    body: JSON.stringify({ zone: zoneId })
  });

  const results = await Promise.all([
    approve(booths[0]._id, t1),
    approve(booths[1]._id, t2),
    approve(booths[2]._id, t1)
  ]);
  const statuses = results.map(r => r.status).sort();
  assert.deepStrictEqual(statuses, [200, 200, 409], `应为 2 成功 1 满员拒绝，实际 ${statuses}`);

  // 满员响应应返回中文原因
  const failed = results.find(r => r.status === 409);
  const failedBody = await failed.json();
  assert.ok(/名额已满/.test(failedBody.message), '满员应返回原因: ' + failedBody.message);

  // 校验数据：2 个 approved、1 个仍 pending、used === 2
  expoDoc = await Expo.findById(expo._id);
  assert.strictEqual(expoDoc.zones[0].used, 2, 'used 应为 2');
  const approvedCount = await Booth.countDocuments({ expoId: expo._id, status: 'approved' });
  const pendingCount = await Booth.countDocuments({ expoId: expo._id, status: 'pending' });
  assert.strictEqual(approvedCount, 2);
  assert.strictEqual(pendingCount, 1, '满员的摊位应继续留在待审核');

  // 重复通过已通过的摊位应报错
  const dup = await approve(booths[0]._id, t2);
  assert.ok([400, 409].includes(dup.status), '重复通过应被拒绝');
  expoDoc = await Expo.findById(expo._id);
  assert.strictEqual(expoDoc.zones[0].used, 2, '重复通过不应多占名额');

  // 下调容量到低于已通过数量 -> 拒绝
  const lower = await fetch(`${base}/expos/${expo._id}/zones/${zone._id}`, {
    method: 'PUT', headers: { 'content-type': 'application/json', Authorization: `Bearer ${t1}` },
    body: JSON.stringify({ capacity: 1 })
  });
  assert.strictEqual(lower.status, 400, '容量下调到 1 应拒绝');
  // 等于已通过数量 -> 允许
  const equal = await fetch(`${base}/expos/${expo._id}/zones/${zone._id}`, {
    method: 'PUT', headers: { 'content-type': 'application/json', Authorization: `Bearer ${t1}` },
    body: JSON.stringify({ capacity: 2 })
  });
  assert.strictEqual(equal.status, 200, '容量设为 2 应成功');

  // 退回一个已通过摊位 -> 名额立即释放
  const repend = await fetch(`${base}/booths/${booths[0]._id}/repend`, {
    method: 'PUT', headers: { Authorization: `Bearer ${t1}` }
  });
  assert.strictEqual(repend.status, 200, '退回待处理应成功');
  expoDoc = await Expo.findById(expo._id);
  assert.strictEqual(expoDoc.zones[0].used, 1, '退回后 used 应为 1');
  const back = await Booth.findById(booths[0]._id);
  assert.strictEqual(back.status, 'pending', '摊位应回到 pending');
  assert.ok(!back.zone, '退回后应清空分区引用');

  // 名额释放后，第 3 个申请可以通过（原满员的那个）
  const retry = await approve(booths[2]._id, t2);
  assert.strictEqual(retry.status, 200, '释放名额后应可通过');
  expoDoc = await Expo.findById(expo._id);
  assert.strictEqual(expoDoc.zones[0].used, 2, 'used 应回到 2');
  assert.strictEqual(await Booth.countDocuments({ expoId: expo._id, status: 'pending' }), 1);

  // 同一摊位被两个管理员同时退回，只能释放一次
  const [r1, r2] = await Promise.all([
    fetch(`${base}/booths/${booths[1]._id}/repend`, { method: 'PUT', headers: { Authorization: `Bearer ${t1}` } }),
    fetch(`${base}/booths/${booths[1]._id}/repend`, { method: 'PUT', headers: { Authorization: `Bearer ${t2}` } })
  ]);
  console.log('repend statuses:', r1.status, r2.status);
  assert.ok(r1.status === 200 && [400, 409].includes(r2.status), `同时退回应一成一败，实际 ${r1.status}/${r2.status}`);
  expoDoc = await Expo.findById(expo._id);
  assert.strictEqual(expoDoc.zones[0].used, 1, '并发退回只能释放一次名额');

  // 拒绝待审核摊位不占名额，且不能重复拒绝
  const [rej1, rej2] = await Promise.all([
    fetch(`${base}/booths/${booths[0]._id}/reject`, { method: 'PUT', headers: { Authorization: `Bearer ${t1}` } }),
    fetch(`${base}/booths/${booths[0]._id}/reject`, { method: 'PUT', headers: { Authorization: `Bearer ${t2}` } })
  ]);
  assert.ok(rej1.status === 200 && [400, 409].includes(rej2.status));
  expoDoc = await Expo.findById(expo._id);
  assert.strictEqual(expoDoc.zones[0].used, 1, '拒绝不影响名额');

  // 无权限用户不能管理分区
  const tv = jwt.sign({ userId: (await User.create({ username: 'x', email: 'x@x.com', password: 'p', role: 'visitor' }))._id.toString() }, JWT_SECRET);
  const forbidden = await fetch(`${base}/expos/${expo._id}/zones`, {
    method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${tv}` },
    body: JSON.stringify({ name: 'z', capacity: 3 })
  });
  assert.strictEqual(forbidden.status, 403, '普通用户不能加分区');

  // 更高强度的并发：容量 5，10 个申请同时通过，恰好 5 个成功
  const expo2 = await Expo.create({
    name: '测试展2', description: 'd', startDate: new Date(), endDate: new Date(), createdBy: owner._id
  });
  await fetch(`${base}/expos/${expo2._id}/zones`, {
    method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${t1}` },
    body: JSON.stringify({ name: '周边区', capacity: 5 })
  });
  expoDoc = await Expo.findById(expo2._id);
  const zone2 = expoDoc.zones[0];
  const moreBooths = [];
  for (let i = 0; i < 10; i++) {
    const v = await User.create({ username: `w${i}`, email: `w${i}@x.com`, password: 'p', role: 'vendor' });
    moreBooths.push(await Booth.create({
      name: `b${i}`, description: 'd', expoId: expo2._id, ownerId: v._id
    }));
  }
  const big = await Promise.all(moreBooths.map((b, i) => approve(b._id, i % 2 ? t1 : t2, zone2._id.toString()).then(r => r.status)));
  const okCount = big.filter(s => s === 200).length;
  const fullCount = big.filter(s => s === 409).length;
  assert.strictEqual(okCount, 5, `容量5应恰好5个成功，实际 ${okCount}`);
  assert.strictEqual(fullCount, 5, `应恰好5个满员失败，实际 ${fullCount}`);
  expoDoc = await Expo.findById(expo2._id);
  assert.strictEqual(expoDoc.zones[0].used, 5);

  // 旧数据迁移：直接在库里造一个没有 used 字段、已有 2 个通过摊位的分区
  const legacyExpoId = new mongoose.Types.ObjectId();
  const legacyZoneId = new mongoose.Types.ObjectId();
  await Expo.collection.insertOne({
    _id: legacyExpoId,
    name: '旧展会', description: 'd',
    startDate: new Date(), endDate: new Date(),
    createdBy: owner._id,
    zones: [{ _id: legacyZoneId, name: '老分区', color: '#000', capacity: 5, position: { x: 0, y: 0, width: 200, height: 150 } }],
    status: 'draft', createdAt: new Date()
  });
  const rawExpo = await Expo.collection.findOne({ _id: legacyExpoId });
  assert.ok(!('used' in rawExpo.zones[0]), '旧分区应无 used 字段');
  expoDoc = await Expo.findById(legacyExpoId);
  const oldZone = expoDoc.zones[0];
  for (let i = 0; i < 2; i++) {
    const v = await User.create({ username: `legacy${i}`, email: `legacy${i}@x.com`, password: 'p', role: 'vendor' });
    await Booth.create({
      name: `lb${i}`, description: 'd', expoId: legacyExpoId, ownerId: v._id,
      status: 'approved', zone: legacyZoneId, zoneName: '老分区'
    });
  }
  // 下调到 1 -> 拒绝（按实际通过数）
  const legacyLower = await fetch(`${base}/expos/${legacyExpoId}/zones/${legacyZoneId}`, {
    method: 'PUT', headers: { 'content-type': 'application/json', Authorization: `Bearer ${t1}` },
    body: JSON.stringify({ capacity: 1 })
  });
  assert.strictEqual(legacyLower.status, 400, '旧分区容量不能低于实际通过数');
  // 下调到 2 -> 成功，且 used 被迁移为 2
  const legacyOk = await fetch(`${base}/expos/${legacyExpoId}/zones/${legacyZoneId}`, {
    method: 'PUT', headers: { 'content-type': 'application/json', Authorization: `Bearer ${t1}` },
    body: JSON.stringify({ capacity: 2 })
  });
  assert.strictEqual(legacyOk.status, 200);
  const legacyBody = await legacyOk.json();
  assert.strictEqual(legacyBody.used, 2, '旧分区 used 应迁移为 2');
  assert.strictEqual(legacyBody.capacity, 2);

  console.log('✅ 全部后端并发/容量测试通过');
  server.close();
  await mongoose.disconnect();
  await mongod.stop();
  process.exit(0);
})().catch(async (e) => {
  console.error('❌ 测试失败:', e);
  process.exit(1);
});

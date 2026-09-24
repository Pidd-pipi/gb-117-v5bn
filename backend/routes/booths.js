const express = require('express');
const mongoose = require('mongoose');
const { auth } = require('../middleware/auth');
const Booth = require('../models/Booth');
const Expo = require('../models/Expo');

const router = express.Router();

/**
 * 原子占用一个分区名额（通过审核时调用）。
 * 通过条件更新保证并发安全：只有「存在且未满」的分区才会把 used +1。
 * 返回: { ok: true, zone, used } | { ok: false, reason: 'not_found' | 'full' }
 */
async function occupyZoneSlot(expoId, zoneId) {
  const result = await Expo.collection.updateOne(
    {
      _id: new mongoose.Types.ObjectId(expoId),
      $expr: {
        $let: {
          vars: {
            z: {
              $arrayElemAt: [
                { $filter: { input: '$zones', cond: { $eq: ['$$this._id', new mongoose.Types.ObjectId(zoneId)] } } },
                0
              ]
            }
          },
          in: {
            $and: [
              { $ne: ['$$z', null] },
              {
                // 未设置容量的旧分区视为不限量
                $or: [
                  { $eq: ['$$z.capacity', null] },
                  { $lt: [{ $ifNull: ['$$z.used', 0] }, '$$z.capacity'] }
                ]
              }
            ]
          }
        }
      }
    },
    { $inc: { 'zones.$[z].used': 1 } },
    {
      arrayFilters: [{ 'z._id': new mongoose.Types.ObjectId(zoneId) }]
    }
  );

  if (result.matchedCount === 0) return { ok: false, reason: 'unknown' };

  const expo = await Expo.findById(expoId);
  const zone = expo?.zones?.find(z => z._id.toString() === zoneId.toString());
  if (!zone) return { ok: false, reason: 'not_found' };
  return { ok: true, zone, used: zone.used };
}

/**
 * 释放一个分区名额（退回待处理时调用）。
 */
async function releaseZoneSlot(expoId, zoneId) {
  if (!zoneId) return;
  const id = typeof zoneId === 'object' ? zoneId.toString() : zoneId;
  await Expo.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(expoId) },
    { $inc: { 'zones.$[z].used': -1 } },
    { arrayFilters: [{ 'z._id': new mongoose.Types.ObjectId(id) }] }
  );
}

/**
 * 根据已占用名额在分区内自动排一个位置。
 */
function nextBoothPosition(zone, used) {
  const width = zone.position?.width || 200;
  const cols = Math.max(1, Math.floor(width / 150));
  const index = Math.max(0, used - 1);
  return {
    x: 12 + (index % cols) * 150,
    y: 44 + Math.floor(index / cols) * 42
  };
}

router.get('/expo/:expoId', async (req, res) => {
  try {
    const booths = await Booth.find({
      expoId: req.params.expoId,
      status: 'approved'
    });
    res.json(booths);
  } catch (error) {
    res.status(500).json({ message: '服务器错误', error: error.message });
  }
});

router.get('/pending', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: '无权限' });
    }
    const booths = await Booth.find({ status: 'pending' })
      .populate('ownerId', 'username email')
      .populate('expoId', 'name zones');
    res.json(booths);
  } catch (error) {
    res.status(500).json({ message: '服务器错误', error: error.message });
  }
});

// 已通过的摊位（管理员可退回待处理）
router.get('/approved', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: '无权限' });
    }
    const booths = await Booth.find({ status: 'approved' })
      .populate('ownerId', 'username email')
      .populate('expoId', 'name zones');
    res.json(booths);
  } catch (error) {
    res.status(500).json({ message: '服务器错误', error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const booth = await Booth.findById(req.params.id).populate('ownerId', 'username');
    if (!booth) {
      return res.status(404).json({ message: '摊位不存在' });
    }
    res.json(booth);
  } catch (error) {
    res.status(500).json({ message: '服务器错误', error: error.message });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const { name, description, products, expoId, zoneName, positionPreference } = req.body;

    const booth = new Booth({
      name,
      description,
      products,
      expoId,
      zoneName,
      positionPreference,
      ownerId: req.user._id
    });

    await booth.save();
    res.status(201).json(booth);
  } catch (error) {
    res.status(500).json({ message: '服务器错误', error: error.message });
  }
});

// 通过审核：原子占用一个名额；满员则保持待审核并返回原因
router.put('/:id/approve', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: '无权限' });
    }

    const { zone, position } = req.body;

    const booth = await Booth.findById(req.params.id);
    if (!booth) {
      return res.status(404).json({ message: '摊位不存在' });
    }
    if (booth.status === 'approved') {
      return res.status(400).json({ message: '该申请已通过' });
    }
    if (booth.status === 'rejected') {
      return res.status(400).json({ message: '该申请已拒绝，无法通过' });
    }

    const expo = await Expo.findById(booth.expoId);
    if (!expo) {
      return res.status(404).json({ message: '展会不存在' });
    }

    let zoneId = zone;
    // 未指定分区时使用摊主的期望分区
    if (!zoneId && booth.zoneName) {
      const preferred = expo.zones.find(z => z.name === booth.zoneName);
      if (preferred) zoneId = preferred._id.toString();
    }
    const targetZone = zoneId ? expo.zones.find(z => z._id.toString() === zoneId.toString()) : null;
    if (!targetZone) {
      return res.status(400).json({ message: '请选择有效的分区' });
    }

    // 原子占用名额，两个管理员同时通过也不会超额
    const claim = await occupyZoneSlot(expo._id, targetZone._id);
    if (!claim.ok) {
      if (claim.reason === 'not_found') {
        return res.status(400).json({ message: '分区不存在' });
      }
      return res.status(409).json({ message: `分区「${targetZone.name}」名额已满（容量 ${targetZone.capacity}），请选择其他分区` });
    }

    const finalPosition = position || nextBoothPosition(targetZone, claim.used);

    // 乐观更新：只有仍处于 pending 才写入，防止并发重复通过
    const approved = await Booth.findOneAndUpdate(
      { _id: booth._id, status: 'pending' },
      {
        status: 'approved',
        zone: targetZone._id,
        zoneName: targetZone.name,
        position: finalPosition
      },
      { new: true }
    );

    if (!approved) {
      // 已被另一个管理员抢先处理，回滚刚占用的名额
      await releaseZoneSlot(expo._id, targetZone._id);
      return res.status(409).json({ message: '该申请已被其他管理员处理，请刷新列表' });
    }

    res.json({
      booth: approved,
      capacity: targetZone.capacity,
      used: claim.used,
      remaining: targetZone.capacity - claim.used
    });
  } catch (error) {
    res.status(500).json({ message: '服务器错误', error: error.message });
  }
});

// 通过后退回待处理：名额立即释放，摊位回到待审核
router.put('/:id/repend', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: '无权限' });
    }

    const booth = await Booth.findById(req.params.id);
    if (!booth) {
      return res.status(404).json({ message: '摊位不存在' });
    }
    if (booth.status !== 'approved') {
      return res.status(400).json({ message: '只有已通过的摊位可以退回待处理' });
    }

    const oldZoneId = booth.zone;
    const expoId = booth.expoId;

    const updated = await Booth.findOneAndUpdate(
      { _id: booth._id, status: 'approved' },
      {
        $set: { status: 'pending' },
        $unset: { zone: 1, position: 1 }
      },
      { new: true }
    );

    if (!updated) {
      return res.status(409).json({ message: '该摊位已被其他管理员处理，请刷新列表' });
    }

    await releaseZoneSlot(expoId, oldZoneId);

    res.json({ message: '已退回待处理，名额已释放', booth: updated });
  } catch (error) {
    res.status(500).json({ message: '服务器错误', error: error.message });
  }
});

router.put('/:id/reject', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: '无权限' });
    }

    // 只有待审核的申请可以拒绝；已通过的需先退回
    const booth = await Booth.findOneAndUpdate(
      { _id: req.params.id, status: 'pending' },
      { status: 'rejected' },
      { new: true }
    );

    if (!booth) {
      const existing = await Booth.findById(req.params.id);
      if (!existing) {
        return res.status(404).json({ message: '摊位不存在' });
      }
      return res.status(400).json({ message: '该申请已被处理，请刷新列表' });
    }

    res.json(booth);
  } catch (error) {
    res.status(500).json({ message: '服务器错误', error: error.message });
  }
});

router.get('/my/:expoId', auth, async (req, res) => {
  try {
    const booth = await Booth.findOne({
      expoId: req.params.expoId,
      ownerId: req.user._id
    });
    res.json(booth);
  } catch (error) {
    res.status(500).json({ message: '服务器错误', error: error.message });
  }
});

module.exports = router;

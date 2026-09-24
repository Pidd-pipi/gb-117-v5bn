const express = require('express');
const { auth } = require('../middleware/auth');
const Expo = require('../models/Expo');
const Booth = require('../models/Booth');

const router = express.Router();

function canManageExpo(expo, user) {
  return expo.createdBy.toString() === user._id.toString() || user.role === 'admin';
}

// 统计某分区当前已通过（占用名额）的摊位数
async function countApprovedInZone(expoId, zoneId) {
  return Booth.countDocuments({
    expoId,
    status: 'approved',
    zone: zoneId
  });
}

router.get('/', async (req, res) => {
  try {
    const expos = await Expo.find().sort({ createdAt: -1 });
    res.json(expos);
  } catch (error) {
    res.status(500).json({ message: '服务器错误', error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const expo = await Expo.findById(req.params.id);
    if (!expo) {
      return res.status(404).json({ message: '展会不存在' });
    }
    res.json(expo);
  } catch (error) {
    res.status(500).json({ message: '服务器错误', error: error.message });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const { name, description, startDate, endDate, coverImage } = req.body;
    
    const expo = new Expo({
      name,
      description,
      startDate,
      endDate,
      coverImage,
      createdBy: req.user._id
    });

    await expo.save();
    res.status(201).json(expo);
  } catch (error) {
    res.status(500).json({ message: '服务器错误', error: error.message });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const expo = await Expo.findById(req.params.id);
    if (!expo) {
      return res.status(404).json({ message: '展会不存在' });
    }

    if (expo.createdBy.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: '无权限修改' });
    }

    const updatedExpo = await Expo.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );

    res.json(updatedExpo);
  } catch (error) {
    res.status(500).json({ message: '服务器错误', error: error.message });
  }
});

router.post('/:id/zones', auth, async (req, res) => {
  try {
    const expo = await Expo.findById(req.params.id);
    if (!expo) {
      return res.status(404).json({ message: '展会不存在' });
    }
    if (!canManageExpo(expo, req.user)) {
      return res.status(403).json({ message: '无权限修改' });
    }

    const { name, color, capacity, position } = req.body;
    const cap = Number(capacity);
    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: '请填写分区名称' });
    }
    if (!Number.isInteger(cap) || cap < 1) {
      return res.status(400).json({ message: '请填写有效的容纳数量（至少为 1 的整数）' });
    }

    expo.zones.push({
      name: String(name).trim(),
      color: color || '#6366f1',
      capacity: cap,
      used: 0,
      position
    });
    await expo.save();

    res.json(expo.zones[expo.zones.length - 1]);
  } catch (error) {
    res.status(500).json({ message: '服务器错误', error: error.message });
  }
});

router.put('/:id/zones/:zoneId', auth, async (req, res) => {
  try {
    const expo = await Expo.findById(req.params.id);
    if (!expo) {
      return res.status(404).json({ message: '展会不存在' });
    }
    if (!canManageExpo(expo, req.user)) {
      return res.status(403).json({ message: '无权限修改' });
    }

    const zone = expo.zones.id(req.params.zoneId);
    if (!zone) {
      return res.status(404).json({ message: '分区不存在' });
    }

    const { name, color, capacity, position } = req.body;

    if (name !== undefined) {
      if (!String(name).trim()) {
        return res.status(400).json({ message: '分区名称不能为空' });
      }
      zone.name = String(name).trim();
    }
    if (color !== undefined) {
      zone.color = color;
    }
    if (position !== undefined) {
      zone.position = position;
    }

    if (capacity !== undefined) {
      const cap = Number(capacity);
      if (!Number.isInteger(cap) || cap < 1) {
        return res.status(400).json({ message: '请填写有效的容纳数量（至少为 1 的整数）' });
      }

      // 旧分区可能没有 used 字段（计数上线前的历史数据），做一次性迁移；
      // 正常分区的 used 由审核接口原子维护，这里不再回写，避免与审核并发互相覆盖。
      // 注意：Mongoose 读取时会给缺失字段填默认值，必须查原始文档判断。
      const rawExpo = await Expo.collection.findOne(
        { _id: expo._id },
        { projection: { zones: 1 } }
      );
      const rawZone = rawExpo?.zones?.find(z => z._id.toString() === zone._id.toString());
      if (rawZone && !('used' in rawZone)) {
        const approvedCount = await countApprovedInZone(expo._id, zone._id);
        await Expo.collection.updateOne(
          { _id: expo._id },
          { $set: { 'zones.$[z].used': approvedCount } },
          { arrayFilters: [{ 'z._id': zone._id }] }
        );
      }

      // 原子设置容量：条件不满足（used > 新容量）时不会写入任何内容；
      // 同请求中的名称/颜色/位置一并写入
      const extraSet = {};
      if (name !== undefined) extraSet['zones.$[z].name'] = zone.name;
      if (color !== undefined) extraSet['zones.$[z].color'] = zone.color;
      if (position !== undefined) extraSet['zones.$[z].position'] = zone.position;

      const result = await Expo.collection.updateOne(
        {
          _id: expo._id,
          $expr: {
            $let: {
              vars: {
                z: {
                  $arrayElemAt: [
                    { $filter: { input: '$zones', cond: { $eq: ['$$this._id', zone._id] } } },
                    0
                  ]
                }
              },
              in: {
                $and: [
                  { $ne: ['$$z', null] },
                  { $gte: [cap, { $ifNull: ['$$z.used', 0] }] }
                ]
              }
            }
          }
        },
        { $set: { 'zones.$[z].capacity': cap, ...extraSet } },
        { arrayFilters: [{ 'z._id': zone._id }] }
      );

      if (result.matchedCount === 0) {
        const approvedCount = await countApprovedInZone(expo._id, zone._id);
        if (approvedCount > cap) {
          return res.status(400).json({
            message: `该分区已有 ${approvedCount} 个通过的摊位，容量不能低于 ${approvedCount}`
          });
        }
        return res.status(409).json({
          message: '调整期间有新的申请通过，当前通过数量已超过该容量，请刷新后重试'
        });
      }

      const fresh = await Expo.findById(expo._id);
      return res.json(fresh.zones.id(req.params.zoneId));
    }

    await expo.save();

    res.json(zone);
  } catch (error) {
    res.status(500).json({ message: '服务器错误', error: error.message });
  }
});

router.delete('/:id/zones/:zoneId', auth, async (req, res) => {
  try {
    const expo = await Expo.findById(req.params.id);
    if (!expo) {
      return res.status(404).json({ message: '展会不存在' });
    }
    if (!canManageExpo(expo, req.user)) {
      return res.status(403).json({ message: '无权限修改' });
    }

    const zone = expo.zones.id(req.params.zoneId);
    if (!zone) {
      return res.status(404).json({ message: '分区不存在' });
    }

    const approvedCount = await countApprovedInZone(expo._id, zone._id);
    if (approvedCount > 0) {
      return res.status(400).json({
        message: `该分区还有 ${approvedCount} 个已通过的摊位，无法删除`
      });
    }

    expo.zones.pull(req.params.zoneId);
    await expo.save();

    res.json({ message: '分区已删除' });
  } catch (error) {
    res.status(500).json({ message: '服务器错误', error: error.message });
  }
});

module.exports = router;

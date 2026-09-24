const express = require('express');
const { auth } = require('../middleware/auth');
const Expo = require('../models/Expo');
const Booth = require('../models/Booth');

const router = express.Router();

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

    const capacity = Number(req.body.capacity);
    if (!Number.isInteger(capacity) || capacity < 0) {
      return res.status(400).json({ message: '请填写有效的容纳数量（非负整数）' });
    }

    expo.zones.push({
      name: req.body.name,
      color: req.body.color,
      position: req.body.position,
      capacity,
      available: capacity
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

    const zone = expo.zones.id(req.params.zoneId);
    if (!zone) {
      return res.status(404).json({ message: '分区不存在' });
    }

    const { name, color, position, capacity } = req.body;
    const set = {};
    if (name !== undefined) set['zones.$.name'] = name;
    if (color !== undefined) set['zones.$.color'] = color;
    if (position !== undefined) set['zones.$.position'] = position;

    let update = { $set: set };
    const filter = {
      _id: req.params.id,
      zones: { $elemMatch: { _id: req.params.zoneId } }
    };

    if (capacity !== undefined) {
      const newCapacity = Number(capacity);
      if (!Number.isInteger(newCapacity) || newCapacity < 0) {
        return res.status(400).json({ message: '容纳数量必须是非负整数' });
      }
      const used = zone.capacity - zone.available;
      if (newCapacity < used) {
        return res.status(400).json({ message: `容纳数量不能低于当前已通过数量（${used}）` });
      }
      // 容量与剩余名额同步增减，已用名额保持不变；用 $inc 原子调整，
      // 并通过 available >= -delta 的查询条件防止与并发审核冲突后剩余名额变负
      const delta = newCapacity - zone.capacity;
      update.$inc = { 'zones.$.capacity': delta, 'zones.$.available': delta };
      if (delta < 0) {
        filter.zones.$elemMatch.available = { $gte: -delta };
      }
    }

    const updated = await Expo.findOneAndUpdate(filter, update, { new: true });
    if (!updated) {
      return res.status(400).json({ message: '容纳数量不能低于当前已通过数量' });
    }

    res.json(updated.zones.id(req.params.zoneId));
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

    expo.zones.pull(req.params.zoneId);
    await expo.save();

    res.json({ message: '分区已删除' });
  } catch (error) {
    res.status(500).json({ message: '服务器错误', error: error.message });
  }
});

module.exports = router;

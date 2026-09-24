const express = require('express');
const { auth } = require('../middleware/auth');
const Booth = require('../models/Booth');
const Expo = require('../models/Expo');

const router = express.Router();

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

router.put('/:id/approve', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: '无权限' });
    }

    const { zoneId, position } = req.body;

    const booth = await Booth.findById(req.params.id);
    if (!booth) {
      return res.status(404).json({ message: '摊位不存在' });
    }
    if (booth.status !== 'pending') {
      return res.status(409).json({ message: '该申请已被处理，请刷新列表' });
    }

    const expo = await Expo.findById(booth.expoId);
    if (!expo) {
      return res.status(404).json({ message: '展会不存在' });
    }

    // 优先使用管理员指定的分区，否则按申请时的期望分区匹配
    let zone = zoneId ? expo.zones.id(zoneId) : null;
    if (!zone && booth.zoneName) {
      zone = expo.zones.find(z => z.name === booth.zoneName);
    }
    if (!zone) {
      return res.status(400).json({ message: '请选择一个有效的分区' });
    }

    // 原子占用名额：仅当剩余名额 > 0 时才递减。
    // 两个管理员同时审核时，数据库会串行化这两个更新，
    // 名额不足的一方匹配不到文档，通过数不会超过容量。
    const slotTaken = await Expo.findOneAndUpdate(
      {
        _id: expo._id,
        zones: { $elemMatch: { _id: zone._id, available: { $gt: 0 } } }
      },
      { $inc: { 'zones.$.available': -1 } },
      { new: true }
    );

    if (!slotTaken) {
      return res.status(409).json({ message: `分区「${zone.name}」名额已满，无法通过该申请` });
    }

    // 原子状态迁移，防止同一申请被并发通过两次
    const approved = await Booth.findOneAndUpdate(
      { _id: booth._id, status: 'pending' },
      { status: 'approved', zone: zone._id, zoneName: zone.name, position },
      { new: true }
    );

    if (!approved) {
      // 申请已被其他管理员处理，释放刚占用的名额
      await Expo.findOneAndUpdate(
        { _id: expo._id, 'zones._id': zone._id },
        { $inc: { 'zones.$.available': 1 } }
      );
      return res.status(409).json({ message: '该申请已被处理，请刷新列表' });
    }

    res.json(approved);
  } catch (error) {
    res.status(500).json({ message: '服务器错误', error: error.message });
  }
});

router.put('/:id/revoke', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: '无权限' });
    }

    // 仅允许已通过的申请退回，原子迁移避免并发重复释放名额
    const booth = await Booth.findOneAndUpdate(
      { _id: req.params.id, status: 'approved' },
      { status: 'pending' },
      { new: true }
    );

    if (!booth) {
      return res.status(404).json({ message: '摊位不存在或不在已通过状态' });
    }

    // 立即释放占用的分区名额
    if (booth.zone) {
      await Expo.findOneAndUpdate(
        { _id: booth.expoId, 'zones._id': booth.zone },
        { $inc: { 'zones.$.available': 1 } }
      );
    }

    res.json(booth);
  } catch (error) {
    res.status(500).json({ message: '服务器错误', error: error.message });
  }
});

router.put('/:id/reject', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: '无权限' });
    }

    const booth = await Booth.findByIdAndUpdate(
      req.params.id,
      { status: 'rejected' },
      { new: true }
    );

    if (!booth) {
      return res.status(404).json({ message: '摊位不存在' });
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

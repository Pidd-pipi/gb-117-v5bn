const mongoose = require('mongoose');

const zoneSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  color: {
    type: String,
    default: '#6366f1'
  },
  capacity: {
    type: Number,
    min: [1, '分区容纳数量至少为 1'],
    validate: {
      validator: Number.isInteger,
      message: '分区容纳数量必须为整数'
    }
  },
  // 已通过（占用名额）的摊位数，由审核接口通过原子操作维护
  used: {
    type: Number,
    default: 0,
    min: 0
  },
  position: {
    x: { type: Number, default: 0 },
    y: { type: Number, default: 0 },
    width: { type: Number, default: 200 },
    height: { type: Number, default: 150 }
  }
});

const expoSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  coverImage: {
    type: String
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  zones: [zoneSchema],
  status: {
    type: String,
    enum: ['draft', 'active', 'ended'],
    default: 'draft'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Expo', expoSchema);

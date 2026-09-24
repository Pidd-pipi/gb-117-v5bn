import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { boothAPI } from '../api'
import { useAuth } from '../contexts/AuthContext'

// 计算分区已用/剩余：以服务端 used 为准，并用已通过摊位数兜底
function zoneStats(zone, approvedBooths) {
  const counted = approvedBooths.filter(b =>
    b.zone ? b.zone === zone._id : b.zoneName === zone.name
  ).length
  const used = Math.max(zone.used ?? counted, counted)
  const capacity = zone.capacity
  if (capacity == null) {
    return { used, capacity: null, remaining: null }
  }
  return { used, capacity, remaining: Math.max(0, capacity - used) }
}

export default function BoothReview() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [tab, setTab] = useState('pending')
  const [pendingBooths, setPendingBooths] = useState([])
  const [approvedBooths, setApprovedBooths] = useState([])
  const [loading, setLoading] = useState(true)
  // 每个摊位选择的分区 id
  const [zoneChoices, setZoneChoices] = useState({})
  const [busyId, setBusyId] = useState(null)

  useEffect(() => {
    if (!user || user.role !== 'admin') {
      navigate('/')
      return
    }
    loadAll()
  }, [user])

  const loadAll = async () => {
    try {
      const [pending, approved] = await Promise.all([
        boothAPI.getPending(),
        boothAPI.getApproved()
      ])
      setPendingBooths(pending.data)
      setApprovedBooths(approved.data)

      // 默认选中摊主的期望分区
      const choices = {}
      for (const booth of pending.data) {
        const zones = booth.expoId?.zones || []
        const preferred = zones.find(z => z.name === booth.zoneName)
        choices[booth._id] = preferred?._id || zones[0]?._id || ''
      }
      setZoneChoices(choices)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const approveBooth = async (booth) => {
    const zoneId = zoneChoices[booth._id]
    if (!zoneId) {
      alert('请先选择分区')
      return
    }
    setBusyId(booth._id)
    try {
      await boothAPI.approve(booth._id, { zone: zoneId })
      await loadAll()
      alert('已通过')
    } catch (err) {
      // 满员/并发冲突：服务端返回原因，摊位仍留在待审核
      alert(err.response?.data?.message || '操作失败')
      await loadAll()
    } finally {
      setBusyId(null)
    }
  }

  const rejectBooth = async (boothId) => {
    setBusyId(boothId)
    try {
      await boothAPI.reject(boothId)
      await loadAll()
      alert('已拒绝')
    } catch (err) {
      alert(err.response?.data?.message || '操作失败')
      await loadAll()
    } finally {
      setBusyId(null)
    }
  }

  const rependBooth = async (boothId) => {
    if (!confirm('确定退回待处理？该分区名额将立即释放。')) return
    setBusyId(boothId)
    try {
      await boothAPI.repend(boothId)
      await loadAll()
      alert('已退回待处理，名额已释放')
    } catch (err) {
      alert(err.response?.data?.message || '操作失败')
      await loadAll()
    } finally {
      setBusyId(null)
    }
  }

  if (loading) {
    return <div className="text-center py-20">加载中...</div>
  }

  const renderZoneSelect = (booth) => {
    const zones = booth.expoId?.zones || []
    const choiceId = zoneChoices[booth._id]
    const selectedZone = zones.find(z => z._id === choiceId)
    const stats = selectedZone ? zoneStats(selectedZone, approvedBooths) : null

    return (
      <div className="mt-3">
        <label className="text-sm font-medium text-gray-600">分配分区：</label>
        <select
          value={choiceId}
          onChange={e => setZoneChoices({ ...zoneChoices, [booth._id]: e.target.value })}
          className="ml-2 px-3 py-1.5 border rounded-lg text-sm"
        >
          {zones.length === 0 && <option value="">该展会暂无分区</option>}
          {zones.map(z => {
            const s = zoneStats(z, approvedBooths)
            return (
              <option key={z._id} value={z._id} disabled={s.capacity != null && s.remaining === 0}>
                {z.name}（已用 {s.used}{s.capacity != null ? `/${s.capacity}，剩 ${s.remaining}` : '，不限量'}）
              </option>
            )
          })}
        </select>
        {stats && stats.capacity != null && (
          <span className={`ml-3 text-xs font-medium ${stats.remaining === 0 ? 'text-red-600' : 'text-gray-500'}`}>
            已用 {stats.used}/{stats.capacity} · 剩余 {stats.remaining}
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold text-gray-800 mb-6">摊位审核</h1>

      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setTab('pending')}
          className={`px-5 py-2 rounded-lg font-medium ${tab === 'pending' ? 'bg-yellow-500 text-white' : 'bg-white text-gray-600 border'}`}
        >
          待审核 ({pendingBooths.length})
        </button>
        <button
          onClick={() => setTab('approved')}
          className={`px-5 py-2 rounded-lg font-medium ${tab === 'approved' ? 'bg-green-600 text-white' : 'bg-white text-gray-600 border'}`}
        >
          已通过 ({approvedBooths.length})
        </button>
      </div>

      {tab === 'pending' && (
        pendingBooths.length === 0 ? (
          <div className="bg-white rounded-xl shadow p-8 text-center">
            <p className="text-gray-500">暂无待审核的摊位申请</p>
          </div>
        ) : (
          <div className="space-y-4">
            {pendingBooths.map(booth => (
              <div key={booth._id} className="bg-white rounded-xl shadow p-6">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <h3 className="text-xl font-bold text-gray-800">{booth.name}</h3>
                    <p className="text-gray-600 mt-2">{booth.description}</p>
                    <div className="mt-3 text-sm text-gray-500 space-y-1">
                      <p><span className="font-medium">所属展会：</span>{booth.expoId?.name || '-'}</p>
                      <p><span className="font-medium">售卖商品：</span>{booth.products}</p>
                      <p><span className="font-medium">期望分区：</span>{booth.zoneName || '未选择'}</p>
                      <p><span className="font-medium">位置偏好：</span>{booth.positionPreference || '未填写'}</p>
                      <p><span className="font-medium">申请人：</span>{booth.ownerId?.username} ({booth.ownerId?.email})</p>
                    </div>
                    {renderZoneSelect(booth)}
                  </div>
                  <div className="flex gap-3 ml-6">
                    <button
                      onClick={() => approveBooth(booth)}
                      disabled={busyId === booth._id || !zoneChoices[booth._id]}
                      className="bg-green-500 text-white px-6 py-2 rounded-lg hover:bg-green-600 disabled:opacity-50"
                    >
                      通过
                    </button>
                    <button
                      onClick={() => rejectBooth(booth._id)}
                      disabled={busyId === booth._id}
                      className="bg-red-500 text-white px-6 py-2 rounded-lg hover:bg-red-600 disabled:opacity-50"
                    >
                      拒绝
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'approved' && (
        approvedBooths.length === 0 ? (
          <div className="bg-white rounded-xl shadow p-8 text-center">
            <p className="text-gray-500">暂无已通过的摊位</p>
          </div>
        ) : (
          <div className="space-y-4">
            {approvedBooths.map(booth => {
              const zone = booth.expoId?.zones?.find(z =>
                booth.zone ? z._id === booth.zone : z.name === booth.zoneName
              )
              const stats = zone ? zoneStats(zone, approvedBooths) : null
              return (
                <div key={booth._id} className="bg-white rounded-xl shadow p-6">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <h3 className="text-xl font-bold text-gray-800">{booth.name}</h3>
                      <div className="mt-3 text-sm text-gray-500 space-y-1">
                        <p><span className="font-medium">所属展会：</span>{booth.expoId?.name || '-'}</p>
                        <p>
                          <span className="font-medium">所在分区：</span>{zone?.name || booth.zoneName || '-'}
                          {stats && stats.capacity != null && (
                            <span className="ml-2 text-xs text-gray-400">
                              （已用 {stats.used}/{stats.capacity} · 剩余 {stats.remaining}）
                            </span>
                          )}
                        </p>
                        <p><span className="font-medium">申请人：</span>{booth.ownerId?.username} ({booth.ownerId?.email})</p>
                      </div>
                    </div>
                    <button
                      onClick={() => rependBooth(booth._id)}
                      disabled={busyId === booth._id}
                      className="bg-yellow-500 text-white px-6 py-2 rounded-lg hover:bg-yellow-600 disabled:opacity-50"
                    >
                      退回待处理
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )
      )}
    </div>
  )
}

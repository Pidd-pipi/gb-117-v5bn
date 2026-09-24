import { useState, useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { expoAPI, boothAPI } from '../api'
import { useAuth } from '../contexts/AuthContext'

export default function ExpoDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [expo, setExpo] = useState(null)
  const [booths, setBooths] = useState([])
  const [loading, setLoading] = useState(true)
  const [newZone, setNewZone] = useState({ name: '', color: '#6366f1', capacity: 10 })
  const [zoneError, setZoneError] = useState('')
  // 正在编辑容量的分区 id -> 输入值
  const [editingCapacity, setEditingCapacity] = useState({})
  const [savingZone, setSavingZone] = useState(null)

  useEffect(() => {
    loadExpo()
    loadBooths()
  }, [id])

  const loadExpo = async () => {
    try {
      const res = await expoAPI.getById(id)
      setExpo(res.data)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const loadBooths = async () => {
    try {
      const res = await boothAPI.getByExpo(id)
      setBooths(res.data)
    } catch (err) {
      console.error(err)
    }
  }

  const addZone = async () => {
    setZoneError('')
    if (!newZone.name) {
      setZoneError('请填写分区名称')
      return
    }
    const cap = Number(newZone.capacity)
    if (!Number.isInteger(cap) || cap < 1) {
      setZoneError('容纳数量必须是不小于 1 的整数')
      return
    }
    try {
      await expoAPI.addZone(id, newZone)
      setNewZone({ name: '', color: '#6366f1', capacity: 10 })
      loadExpo()
    } catch (err) {
      setZoneError(err.response?.data?.message || '添加失败')
    }
  }

  const usedInZone = (zone) => {
    const counted = booths.filter(b =>
      b.zone ? b.zone === zone._id : b.zoneName === zone.name
    ).length
    return Math.max(zone.used ?? counted, counted)
  }

  const startEditCapacity = (zone) => {
    setZoneError('')
    setEditingCapacity({ ...editingCapacity, [zone._id]: zone.capacity ?? usedInZone(zone) })
  }

  const saveCapacity = async (zone) => {
    const cap = Number(editingCapacity[zone._id])
    setZoneError('')
    if (!Number.isInteger(cap) || cap < 1) {
      setZoneError('容纳数量必须是不小于 1 的整数')
      return
    }
    setSavingZone(zone._id)
    try {
      await expoAPI.updateZone(id, zone._id, { capacity: cap })
      setEditingCapacity(prev => {
        const next = { ...prev }
        delete next[zone._id]
        return next
      })
      await loadExpo()
    } catch (err) {
      setZoneError(err.response?.data?.message || '容量更新失败')
    } finally {
      setSavingZone(null)
    }
  }

  if (loading) {
    return <div className="text-center py-20">加载中...</div>
  }

  if (!expo) {
    return <div className="text-center py-20">展会不存在</div>
  }

  const isOwner = user && expo.createdBy === user.id

  return (
    <div>
      <div className="bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl p-8 mb-8 text-white">
        <h1 className="text-4xl font-bold mb-4">{expo.name}</h1>
        <p className="text-lg opacity-90 mb-4">{expo.description}</p>
        <div className="flex gap-6">
          <div className="flex items-center">
            <span className="text-2xl mr-2">📅</span>
            <span>{new Date(expo.startDate).toLocaleDateString()} - {new Date(expo.endDate).toLocaleDateString()}</span>
          </div>
        </div>
      </div>

      <div className="flex gap-4 mb-8">
        <Link to={`/expo/${id}/map`} className="bg-purple-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-purple-700">
          🗺️ 查看展位地图
        </Link>
        <Link to={`/expo/${id}/schedule`} className="bg-pink-500 text-white px-6 py-3 rounded-lg font-semibold hover:bg-pink-600">
          📋 活动时间表
        </Link>
        {user && (
          <Link to={`/expo/${id}/apply`} className="bg-green-500 text-white px-6 py-3 rounded-lg font-semibold hover:bg-green-600">
            🎪 申请摊位
          </Link>
        )}
      </div>

      {isOwner && (
        <div className="bg-white rounded-xl shadow p-6 mb-8">
          <h3 className="text-xl font-bold text-gray-800 mb-4">管理分区</h3>
          {zoneError && (
            <div className="bg-red-100 text-red-700 p-3 rounded-lg mb-4 text-sm">{zoneError}</div>
          )}
          <div className="flex flex-wrap gap-4 mb-4 items-center">
            <input
              type="text"
              placeholder="分区名称"
              value={newZone.name}
              onChange={e => setNewZone({ ...newZone, name: e.target.value })}
              className="flex-1 min-w-[160px] px-4 py-2 border rounded-lg"
            />
            <input
              type="number"
              min="1"
              step="1"
              placeholder="容纳数量"
              value={newZone.capacity}
              onChange={e => setNewZone({ ...newZone, capacity: e.target.value })}
              className="w-32 px-4 py-2 border rounded-lg"
            />
            <input
              type="color"
              value={newZone.color}
              onChange={e => setNewZone({ ...newZone, color: e.target.value })}
              className="w-16 h-10 rounded cursor-pointer"
            />
            <button onClick={addZone} className="bg-purple-600 text-white px-6 py-2 rounded-lg">
              添加分区
            </button>
          </div>
          <div className="flex flex-wrap gap-3">
            {expo.zones?.map(zone => {
              const used = usedInZone(zone)
              const remaining = zone.capacity == null ? null : Math.max(0, zone.capacity - used)
              const editing = editingCapacity[zone._id] !== undefined
              return (
                <div key={zone._id} className="rounded-lg text-white px-4 py-3 min-w-[180px]" style={{ backgroundColor: zone.color }}>
                  <div className="font-bold">{zone.name}</div>
                  <div className="text-xs opacity-90 mt-1">
                    {zone.capacity == null
                      ? `已用 ${used} · 未设容量`
                      : `已用 ${used}/${zone.capacity} · 剩余 ${remaining}`}
                  </div>
                  {editing ? (
                    <div className="mt-2 flex gap-1">
                      <input
                        type="number"
                        min="1"
                        value={editingCapacity[zone._id]}
                        onChange={e => setEditingCapacity({ ...editingCapacity, [zone._id]: e.target.value })}
                        className="w-20 px-2 py-1 rounded text-gray-800 text-sm"
                      />
                      <button
                        onClick={() => saveCapacity(zone)}
                        disabled={savingZone === zone._id}
                        className="bg-white/30 hover:bg-white/40 px-2 py-1 rounded text-xs"
                      >
                        保存
                      </button>
                      <button
                        onClick={() => setEditingCapacity(prev => {
                          const next = { ...prev }
                          delete next[zone._id]
                          return next
                        })}
                        className="bg-white/20 hover:bg-white/30 px-2 py-1 rounded text-xs"
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => startEditCapacity(zone)}
                      className="mt-2 text-xs underline opacity-90 hover:opacity-100"
                    >
                      调整容量
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow p-6">
        <h3 className="text-xl font-bold text-gray-800 mb-6">已入驻摊位 ({booths.length})</h3>
        {booths.length === 0 ? (
          <p className="text-gray-500 text-center py-8">暂无摊位</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {booths.map(booth => (
              <Link key={booth._id} to={`/booth/${booth._id}`}>
                <div className="border rounded-lg p-4 hover:shadow-md transition-shadow">
                  <h4 className="font-bold text-gray-800">{booth.name}</h4>
                  <p className="text-sm text-gray-500 mt-1">{booth.description}</p>
                  {booth.zoneName && (
                    <span className="inline-block mt-2 text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded">
                      {booth.zoneName}
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

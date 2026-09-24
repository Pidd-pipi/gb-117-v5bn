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
  const [newZone, setNewZone] = useState({ name: '', color: '#6366f1', capacity: '' })
  const [editingCapacity, setEditingCapacity] = useState({})

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
    if (!newZone.name) return
    const capacity = parseInt(newZone.capacity, 10)
    if (!Number.isInteger(capacity) || capacity < 0) {
      alert('请填写有效的容纳数量（非负整数）')
      return
    }
    try {
      await expoAPI.addZone(id, { ...newZone, capacity })
      setNewZone({ name: '', color: '#6366f1', capacity: '' })
      loadExpo()
    } catch (err) {
      alert(err.response?.data?.message || '添加分区失败')
    }
  }

  const updateCapacity = async (zoneId) => {
    const capacity = parseInt(editingCapacity[zoneId], 10)
    if (!Number.isInteger(capacity) || capacity < 0) {
      alert('请填写有效的容纳数量（非负整数）')
      return
    }
    try {
      await expoAPI.updateZone(id, zoneId, { capacity })
      setEditingCapacity({ ...editingCapacity, [zoneId]: undefined })
      loadExpo()
    } catch (err) {
      alert(err.response?.data?.message || '更新容纳数量失败')
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
          <div className="flex flex-wrap gap-4 mb-4">
            <input
              type="text"
              placeholder="分区名称"
              value={newZone.name}
              onChange={e => setNewZone({ ...newZone, name: e.target.value })}
              className="flex-1 min-w-[160px] px-4 py-2 border rounded-lg"
            />
            <input
              type="number"
              min="0"
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
          <div className="space-y-3">
            {expo.zones?.map(zone => {
              const used = zone.capacity - zone.available
              const full = zone.available <= 0
              return (
                <div
                  key={zone._id}
                  className="flex flex-wrap items-center gap-3 px-4 py-3 rounded-lg border"
                >
                  <div className="w-4 h-4 rounded shrink-0" style={{ backgroundColor: zone.color }} />
                  <span className="font-medium text-gray-800">{zone.name}</span>
                  <span className={`text-sm ${full ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                    已用 {used}/{zone.capacity} · 剩余 {zone.available}
                  </span>
                  <div className="flex items-center gap-2 ml-auto">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      placeholder="新容量"
                      value={editingCapacity[zone._id] ?? ''}
                      onChange={e => setEditingCapacity({ ...editingCapacity, [zone._id]: e.target.value })}
                      className="w-24 px-2 py-1 border rounded text-sm"
                    />
                    <button
                      onClick={() => updateCapacity(zone._id)}
                      className="text-sm text-purple-600 hover:underline"
                    >
                      调整容量
                    </button>
                  </div>
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

import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { expoAPI, boothAPI } from '../api'

// 分区内摊位：优先用 zone 引用匹配，兼容旧数据按分区名匹配
function boothsInZone(booths, zone) {
  return booths.filter(b =>
    b.zone ? b.zone === zone._id : b.zoneName === zone.name
  )
}

export default function ExpoMap() {
  const { id } = useParams()
  const [expo, setExpo] = useState(null)
  const [booths, setBooths] = useState([])
  const [loading, setLoading] = useState(true)

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

  if (loading) {
    return <div className="text-center py-20">加载中...</div>
  }

  const renderCapacity = (zone) => {
    const used = boothsInZone(booths, zone).length
    if (zone.capacity == null) {
      return <span className="text-xs text-gray-600">已用 {used}</span>
    }
    const realUsed = Math.max(zone.used ?? used, used)
    const remaining = Math.max(0, zone.capacity - realUsed)
    const full = remaining === 0
    return (
      <span className={`text-xs font-medium ${full ? 'text-red-600' : 'text-gray-600'}`}>
        已用 {realUsed}/{zone.capacity} · 剩余 {remaining}
      </span>
    )
  }

  return (
    <div>
      <div className="mb-6">
        <Link to={`/expo/${id}`} className="text-purple-600 hover:underline">← 返回展会详情</Link>
        <h1 className="text-3xl font-bold text-gray-800 mt-2">展会地图</h1>
      </div>

      <div className="bg-white rounded-xl shadow-lg p-8">
        <div className="relative bg-gray-100 rounded-lg" style={{ minHeight: '500px' }}>
          {expo.zones?.map(zone => (
            <div
              key={zone._id}
              className="absolute rounded-lg p-4 border-2 overflow-auto"
              style={{
                left: (zone.position?.x || 50) + 'px',
                top: (zone.position?.y || 50) + 'px',
                width: (zone.position?.width || 200) + 'px',
                height: (zone.position?.height || 150) + 'px',
                backgroundColor: zone.color + '30',
                borderColor: zone.color
              }}
            >
              <div className="flex items-center justify-between mb-2 gap-2">
                <h3 className="font-bold text-gray-800">{zone.name}</h3>
                {renderCapacity(zone)}
              </div>
              <div className="space-y-1">
                {boothsInZone(booths, zone).map(booth => (
                  <Link key={booth._id} to={`/booth/${booth._id}`}>
                    <div className="text-xs bg-white rounded px-2 py-1 hover:bg-gray-50">
                      {booth.name}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))}

          {booths.filter(b => !b.zone && !b.zoneName).map(booth => (
            <Link
              key={booth._id}
              to={`/booth/${booth._id}`}
              className="absolute bg-white rounded-lg shadow p-3 hover:shadow-md"
              style={{
                left: (booth.position?.x || Math.random() * 400 + 100) + 'px',
                top: (booth.position?.y || Math.random() * 300 + 100) + 'px'
              }}
            >
              <div className="text-sm font-medium text-gray-800">{booth.name}</div>
            </Link>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap gap-4">
          {expo.zones?.map(zone => {
            const used = boothsInZone(booths, zone).length
            const realUsed = Math.max(zone.used ?? used, used)
            return (
              <div key={zone._id} className="flex items-center gap-2">
                <div className="w-4 h-4 rounded" style={{ backgroundColor: zone.color }} />
                <span className="text-sm text-gray-600">
                  {zone.name}
                  {zone.capacity != null && `（${realUsed}/${zone.capacity}）`}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

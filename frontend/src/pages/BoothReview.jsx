import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { boothAPI } from '../api'
import { useAuth } from '../contexts/AuthContext'

export default function BoothReview() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [pendingBooths, setPendingBooths] = useState([])
  const [approvedBooths, setApprovedBooths] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('pending')
  // 每个申请选择要放入的分区，默认按申请时的期望分区
  const [zoneChoice, setZoneChoice] = useState({})

  useEffect(() => {
    if (!user || user.role !== 'admin') {
      navigate('/')
      return
    }
    loadAll()
  }, [user])

  const loadAll = async () => {
    setLoading(true)
    try {
      const [pendingRes, approvedRes] = await Promise.all([
        boothAPI.getPending(),
        boothAPI.getApproved()
      ])
      setPendingBooths(pendingRes.data)
      setApprovedBooths(approvedRes.data)
      setZoneChoice(prev => {
        const next = { ...prev }
        pendingRes.data.forEach(booth => {
          if (!next[booth._id]) {
            const zones = booth.expoId?.zones || []
            const preferred = zones.find(z => z.name === booth.zoneName)
            next[booth._id] = preferred?._id || zones[0]?._id || ''
          }
        })
        return next
      })
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const approveBooth = async (booth) => {
    const zoneId = zoneChoice[booth._id]
    if (!zoneId) {
      alert('请先选择分区')
      return
    }
    try {
      await boothAPI.approve(booth._id, { zoneId })
      await loadAll()
    } catch (err) {
      // 满员时后端返回原因，摊位仍在待审核列表中
      alert(err.response?.data?.message || '操作失败')
      loadAll()
    }
  }

  const rejectBooth = async (boothId) => {
    try {
      await boothAPI.reject(boothId)
      await loadAll()
    } catch (err) {
      alert(err.response?.data?.message || '操作失败')
    }
  }

  const revokeBooth = async (boothId) => {
    try {
      await boothAPI.revoke(boothId)
      await loadAll()
    } catch (err) {
      alert(err.response?.data?.message || '操作失败')
    }
  }

  if (loading) {
    return <div className="text-center py-20">加载中...</div>
  }

  // 聚合审核页涉及到的各展会分区容量情况
  const expoMap = {}
  ;[...pendingBooths, ...approvedBooths].forEach(booth => {
    const expo = booth.expoId
    if (expo && !expoMap[expo._id]) expoMap[expo._id] = expo
  })
  const expos = Object.values(expoMap)

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold text-gray-800 mb-8">摊位审核</h1>

      {expos.length > 0 && (
        <div className="bg-white rounded-xl shadow p-6 mb-8">
          <h3 className="text-lg font-bold text-gray-800 mb-4">分区名额</h3>
          <div className="space-y-4">
            {expos.map(expo => (
              <div key={expo._id}>
                <p className="text-sm font-medium text-gray-700 mb-2">{expo.name}</p>
                <div className="flex flex-wrap gap-2">
                  {expo.zones?.map(zone => {
                    const used = zone.capacity - zone.available
                    const full = zone.available <= 0
                    return (
                      <span
                        key={zone._id}
                        className={`inline-flex items-center gap-1 text-sm px-3 py-1 rounded-full border ${
                          full ? 'border-red-300 bg-red-50 text-red-600' : 'border-gray-200 bg-gray-50 text-gray-600'
                        }`}
                      >
                        <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: zone.color }} />
                        {zone.name}：已用 {used}/{zone.capacity}，剩余 {zone.available}
                        {full && '（已满）'}
                      </span>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setTab('pending')}
          className={`px-5 py-2 rounded-lg font-medium ${
            tab === 'pending' ? 'bg-purple-600 text-white' : 'bg-white text-gray-600 border'
          }`}
        >
          待审核 ({pendingBooths.length})
        </button>
        <button
          onClick={() => setTab('approved')}
          className={`px-5 py-2 rounded-lg font-medium ${
            tab === 'approved' ? 'bg-purple-600 text-white' : 'bg-white text-gray-600 border'
          }`}
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
            {pendingBooths.map(booth => {
              const zones = booth.expoId?.zones || []
              const selectedZone = zones.find(z => z._id === zoneChoice[booth._id])
              const zoneFull = selectedZone && selectedZone.available <= 0
              return (
                <div key={booth._id} className="bg-white rounded-xl shadow p-6">
                  <div className="flex justify-between items-start flex-wrap gap-4">
                    <div className="flex-1 min-w-[260px]">
                      <h3 className="text-xl font-bold text-gray-800">{booth.name}</h3>
                      <p className="text-gray-600 mt-2">{booth.description}</p>
                      <div className="mt-3 text-sm text-gray-500 space-y-1">
                        <p><span className="font-medium">售卖商品：</span>{booth.products}</p>
                        <p><span className="font-medium">期望分区：</span>{booth.zoneName || '未选择'}</p>
                        <p><span className="font-medium">位置偏好：</span>{booth.positionPreference || '未填写'}</p>
                        <p><span className="font-medium">申请人：</span>{booth.ownerId?.username} ({booth.ownerId?.email})</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-3 ml-6">
                      {zones.length > 0 ? (
                        <div className="text-right">
                          <select
                            value={zoneChoice[booth._id] || ''}
                            onChange={e => setZoneChoice({ ...zoneChoice, [booth._id]: e.target.value })}
                            className="px-3 py-2 border rounded-lg text-sm"
                          >
                            {zones.map(zone => (
                              <option key={zone._id} value={zone._id}>
                                {zone.name}（剩余 {zone.available}/{zone.capacity}）
                              </option>
                            ))}
                          </select>
                          {zoneFull && (
                            <p className="text-xs text-red-600 mt-1">该分区已满员</p>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-red-600">展会尚未创建分区，无法通过</p>
                      )}
                      <div className="flex gap-3">
                        <button
                          onClick={() => approveBooth(booth)}
                          disabled={!selectedZone || zoneFull}
                          className="bg-green-500 text-white px-6 py-2 rounded-lg hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
                        >
                          通过
                        </button>
                        <button
                          onClick={() => rejectBooth(booth._id)}
                          className="bg-red-500 text-white px-6 py-2 rounded-lg hover:bg-red-600"
                        >
                          拒绝
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
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
            {approvedBooths.map(booth => (
              <div key={booth._id} className="bg-white rounded-xl shadow p-6">
                <div className="flex justify-between items-start flex-wrap gap-4">
                  <div className="flex-1 min-w-[260px]">
                    <h3 className="text-xl font-bold text-gray-800">{booth.name}</h3>
                    <div className="mt-3 text-sm text-gray-500 space-y-1">
                      <p><span className="font-medium">所属展会：</span>{booth.expoId?.name || '未知'}</p>
                      <p><span className="font-medium">所在分区：</span>{booth.zoneName || '未分配'}</p>
                      <p><span className="font-medium">申请人：</span>{booth.ownerId?.username}</p>
                    </div>
                  </div>
                  <div className="ml-6">
                    <button
                      onClick={() => revokeBooth(booth._id)}
                      className="bg-yellow-500 text-white px-6 py-2 rounded-lg hover:bg-yellow-600"
                    >
                      退回待处理
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  )
}

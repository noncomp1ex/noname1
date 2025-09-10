import { NextRequest, NextResponse } from 'next/server'

// Room structure with display names
const rooms = new Map<string, { host: { id: string, name: string }, guests: { id: string, name: string }[] }>()
// In-memory per-room message queues: roomId -> recipientPeerId -> messages[]
const queues = new Map<string, Map<string, any[]>>()

function getRoomQueue(roomId: string): Map<string, any[]> {
  if (!queues.has(roomId)) queues.set(roomId, new Map())
  return queues.get(roomId) as Map<string, any[]>
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json()
    const { action } = payload || {}

    switch (action) {
      case 'join': {
        const { roomId, peerId, displayName } = payload
        const name = displayName || peerId
        if (!rooms.has(roomId)) {
          rooms.set(roomId, { host: { id: peerId, name }, guests: [] })
          return NextResponse.json({ isHost: true, hostId: peerId, displayName: name })
        } else {
          const room = rooms.get(roomId)!
          // Avoid duplicates if rejoining with same id
          if (!room.guests.find(g => g.id === peerId)) {
            room.guests.push({ id: peerId, name })
          }
          return NextResponse.json({ isHost: false, hostId: room.host.id, guests: room.guests, hostName: room.host.name })
        }
      }
      case 'leave': {
        const { roomId, peerId } = payload
        if (rooms.has(roomId)) {
          const room = rooms.get(roomId)!
          if (room.host.id === peerId) {
            rooms.delete(roomId)
            queues.delete(roomId)
          } else {
            room.guests = room.guests.filter(g => g.id !== peerId)
            const q = queues.get(roomId)
            if (q) q.delete(peerId)
          }
        }
        return NextResponse.json({ success: true })
      }
      case 'get-room': {
        const { roomId } = payload
        const room = rooms.get(roomId)
        if (room) {
          return NextResponse.json({ host: room.host, guests: room.guests })
        }
        return NextResponse.json({ error: 'Room not found' }, { status: 404 })
      }
      // Enqueue an SDP offer for a recipient
      case 'offer': {
        const { roomId, to, from, sdp } = payload
        const rq = getRoomQueue(roomId)
        if (!rq.has(to)) rq.set(to, [])
        rq.get(to)!.push({ type: 'offer', from, sdp, ts: Date.now() })
        return NextResponse.json({ queued: true })
      }
      // Enqueue an SDP answer
      case 'answer': {
        const { roomId, to, from, sdp } = payload
        const rq = getRoomQueue(roomId)
        if (!rq.has(to)) rq.set(to, [])
        rq.get(to)!.push({ type: 'answer', from, sdp, ts: Date.now() })
        return NextResponse.json({ queued: true })
      }
      // Enqueue ICE candidate
      case 'candidate': {
        const { roomId, to, from, candidate } = payload
        const rq = getRoomQueue(roomId)
        if (!rq.has(to)) rq.set(to, [])
        rq.get(to)!.push({ type: 'candidate', from, candidate, ts: Date.now() })
        return NextResponse.json({ queued: true })
      }
      // Pull and drain all pending messages for a peer
      case 'pull': {
        const { roomId, forPeer } = payload
        const rq = getRoomQueue(roomId)
        const msgs = rq.get(forPeer) || []
        rq.set(forPeer, [])
        return NextResponse.json({ messages: msgs })
      }
      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

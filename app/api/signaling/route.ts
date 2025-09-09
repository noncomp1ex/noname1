import { NextRequest, NextResponse } from 'next/server'

// Update room structure to include display names
const rooms = new Map<string, { host: { id: string, name: string }, guests: { id: string, name: string }[] }>()

export async function POST(request: NextRequest) {
  try {
    const { action, roomId, peerId, displayName } = await request.json()

    switch (action) {
      case 'join': {
        const name = displayName || peerId
        if (!rooms.has(roomId)) {
          // First user becomes host
          rooms.set(roomId, { host: { id: peerId, name }, guests: [] })
          return NextResponse.json({ isHost: true, hostId: peerId, displayName: name })
        } else {
          // Add as guest
          const room = rooms.get(roomId)!
          room.guests.push({ id: peerId, name })
          return NextResponse.json({
            isHost: false,
            hostId: room.host.id,
            guests: room.guests,
            hostName: room.host.name
          })
        }
      }
      case 'leave': {
        if (rooms.has(roomId)) {
          const room = rooms.get(roomId)!
          if (room.host.id === peerId) {
            // Host leaving, remove room
            rooms.delete(roomId)
          } else {
            // Guest leaving, remove from guests
            room.guests = room.guests.filter(g => g.id !== peerId)
          }
        }
        return NextResponse.json({ success: true })
      }
      case 'get-room': {
        const room = rooms.get(roomId)
        if (room) {
          return NextResponse.json({
            host: room.host,
            guests: room.guests
          })
        }
        return NextResponse.json({ error: 'Room not found' }, { status: 404 })
      }
      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

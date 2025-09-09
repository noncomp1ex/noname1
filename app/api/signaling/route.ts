import { NextRequest, NextResponse } from 'next/server'

// Simple in-memory signaling store (resets on each serverless function cold start)
const rooms = new Map<string, { hostId: string; guests: string[] }>()

export async function POST(request: NextRequest) {
  try {
    const { action, roomId, peerId } = await request.json()

    switch (action) {
      case 'join':
        if (!rooms.has(roomId)) {
          // First user becomes host
          rooms.set(roomId, { hostId: peerId, guests: [] })
          return NextResponse.json({ isHost: true, hostId: peerId })
        } else {
          // Add as guest
          const room = rooms.get(roomId)!
          room.guests.push(peerId)
          return NextResponse.json({ 
            isHost: false, 
            hostId: room.hostId,
            guests: room.guests 
          })
        }

      case 'leave':
        if (rooms.has(roomId)) {
          const room = rooms.get(roomId)!
          if (room.hostId === peerId) {
            // Host leaving, remove room
            rooms.delete(roomId)
          } else {
            // Guest leaving, remove from guests
            room.guests = room.guests.filter(id => id !== peerId)
          }
        }
        return NextResponse.json({ success: true })

      case 'get-room':
        const room = rooms.get(roomId)
        if (room) {
          return NextResponse.json({ 
            hostId: room.hostId, 
            guests: room.guests 
          })
        }
        return NextResponse.json({ error: 'Room not found' }, { status: 404 })

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

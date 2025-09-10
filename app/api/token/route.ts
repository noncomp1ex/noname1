import { NextRequest, NextResponse } from 'next/server'
import { AccessToken } from 'livekit-server-sdk'

// WARNING: Hard-coding secrets is unsafe. This is for quick testing only.
const LIVEKIT_URL = 'wss://noname1-dmvoer44.livekit.cloud'
const LIVEKIT_API_KEY = 'APIEGQiQL6WaEmT'
const LIVEKIT_API_SECRET = 'J9jMsoeJVOqEDf2dnLZf8ZsDtuKetpjyQqXgr9qeZJ9C'

export async function POST(req: NextRequest) {
  try {
    const { roomName, identity, name } = await req.json()
    if (!roomName || !identity) {
      return NextResponse.json({ error: 'roomName and identity required' }, { status: 400 })
    }

    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity,
      name: name || identity,
    })
    at.addGrant({ room: roomName, roomJoin: true, canPublish: true, canSubscribe: true })

    const token = await at.toJwt()
    return NextResponse.json({ token, url: LIVEKIT_URL })
  } catch (e) {
    return NextResponse.json({ error: 'token error' }, { status: 500 })
  }
}

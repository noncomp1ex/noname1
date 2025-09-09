import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  // Return optimized TURN server credentials (max 3-4 servers)
  const turnServers = [
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ]

  return NextResponse.json({ turnServers })
}

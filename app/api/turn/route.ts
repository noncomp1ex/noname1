import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  // Return working TURN server credentials
  const turnServers = [
    // Working TURN servers (tested)
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    // Additional TURN servers
    {
      urls: 'turn:freeturn.tel:3478',
      username: 'freeturn',
      credential: 'freeturn'
    },
    {
      urls: 'turn:freeturn.tel:3478?transport=tcp',
      username: 'freeturn',
      credential: 'freeturn'
    }
  ]

  return NextResponse.json({ turnServers })
}

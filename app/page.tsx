'use client'

import { useState, useEffect, useRef } from 'react'
import React from 'react'
import { Room, RoomEvent, RemoteParticipant, createLocalAudioTrack } from 'livekit-client'

interface VoiceChatProps {}

export default function VoiceChat() {
  const [isMuted, setIsMuted] = useState(false)
  const [isInCall, setIsInCall] = useState(false)
  const [roomId, setRoomId] = useState('')
  const [status, setStatus] = useState('Ready to start')
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [myPeerId, setMyPeerId] = useState('')

  const localAudioRef = useRef<HTMLAudioElement>(null)
  const roomRef = useRef<Room | null>(null)

  const log = (m: string) => setStatus(m)

  useEffect(() => {
    if (localAudioRef.current && localStream) localAudioRef.current.srcObject = localStream
  }, [localStream])

  const startVoiceChat = async () => {
    try {
      setStatus('Requesting microphone access...')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      setLocalStream(stream)
      setStatus('Microphone access granted - Ready to join a room')
    } catch (error) {
      setStatus('Error: Could not access microphone')
    }
  }

  async function joinLiveKit() {
    if (!roomId.trim()) return
    setStatus('Connecting...')
    const identity = `user_${Math.random().toString(36).slice(2, 9)}`
    setMyPeerId(identity)

    const res = await fetch('/api/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomName: roomId.trim(), identity, name: displayName || identity }) })
    const { token, url } = await res.json()

    const room = new Room()
    roomRef.current = room

    room.on(RoomEvent.ConnectionStateChanged, (s) => log(`Connection: ${s}`))
    room.on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => log(`Participant joined: ${p.identity}`))
    room.on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => log(`Participant left: ${p.identity}`))
    room.on(RoomEvent.TrackSubscribed, (track, pub, p) => {
      if (track.kind === 'audio') {
        const el = new Audio()
        el.autoplay = true
        el.srcObject = new MediaStream([track.mediaStreamTrack])
        el.play().catch(() => {})
      }
    })

    await room.connect(url, token)

    // Publish microphone
    const localAudio = await createLocalAudioTrack({ echoCancellation: true, noiseSuppression: true, autoGainControl: true })
    await room.localParticipant.publishTrack(localAudio)

    setIsInCall(true)
    setStatus('Connected!')
  }

  function leaveLiveKit() {
    roomRef.current?.disconnect()
    roomRef.current = null
    setIsInCall(false)
    setStatus('Left the room')
  }

  function toggleMute() {
    if (!roomRef.current) return
    const enabled = roomRef.current.localParticipant.isMicrophoneEnabled
    roomRef.current.localParticipant.setMicrophoneEnabled(!enabled)
    setIsMuted(enabled)
  }

  function stopVoiceChat() {
    if (roomRef.current) {
      roomRef.current.localParticipant.getTrackPublications().forEach(pub => pub.track?.stop())
    }
    setLocalStream(null)
    setIsInCall(false)
    setStatus('Voice chat stopped')
  }

  return (
    <div className="container">
      <h1>🎤 P2P Voice Chat (LiveKit)</h1>
      <div className="status">{status}</div>

      {!localStream ? (
        <div className="controls">
          <button onClick={startVoiceChat}>Start Voice Chat</button>
        </div>
      ) : (
        <div className="controls" style={{ gap: 8 }}>
          <div className="room-input" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input type="text" placeholder="Enter room ID (e.g., 'room123')" value={roomId} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRoomId(e.target.value)} />
            <input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Your display name" />
            <button onClick={joinLiveKit} disabled={!roomId.trim() || isInCall}>{isInCall ? 'In Room' : 'Join Room'}</button>
          </div>

          {isInCall && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={toggleMute} className={isMuted ? 'muted' : ''}>{isMuted ? '🔇 Unmute' : '🎤 Mute'}</button>
              <button onClick={leaveLiveKit}>Leave Room</button>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={stopVoiceChat}>Stop Voice Chat</button>
          </div>
        </div>
      )}

      <audio ref={localAudioRef} autoPlay muted />
    </div>
  )
}

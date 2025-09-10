'use client'

import { useState, useEffect, useRef } from 'react'
import React from 'react'
import { Room, RoomEvent, RemoteParticipant, createLocalAudioTrack, createLocalVideoTrack } from 'livekit-client'

interface VoiceChatProps {}

export default function VoiceChat() {
  const [isMuted, setIsMuted] = useState(false)
  const [isInCall, setIsInCall] = useState(false)
  const [isSharing, setIsSharing] = useState(false)
  const [roomId, setRoomId] = useState('')
  const [status, setStatus] = useState('Ready to start')
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [myPeerId, setMyPeerId] = useState('')
  const [remoteVideoStreams, setRemoteVideoStreams] = useState<Map<string, MediaStream>>(new Map())

  const localAudioRef = useRef<HTMLAudioElement>(null)
  const roomRef = useRef<Room | null>(null)
  const videoContainerRef = useRef<HTMLDivElement>(null)

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
      } else if (track.kind === 'video') {
        const videoStream = new MediaStream([track.mediaStreamTrack])
        setRemoteVideoStreams(prev => new Map(prev.set(p.identity, videoStream)))
      }
    })

    room.on(RoomEvent.TrackUnsubscribed, (track, pub, p) => {
      if (track.kind === 'video') {
        setRemoteVideoStreams(prev => {
          const newMap = new Map(prev)
          newMap.delete(p.identity)
          return newMap
        })
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
    if (isSharing) {
      stopScreenShare()
    }
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
    setScreenStream(null)
    setIsInCall(false)
    setIsSharing(false)
    setStatus('Voice chat stopped')
  }

  async function startScreenShare() {
    if (!roomRef.current || isSharing) return
    
    try {
      setStatus('Requesting screen share access...')
      const stream = await navigator.mediaDevices.getDisplayMedia({ 
        video: true,
        audio: false 
      })
      
      setScreenStream(stream)
      
      // Publish video track directly
      await roomRef.current.localParticipant.publishTrack(stream.getVideoTracks()[0])
      
      setIsSharing(true)
      setStatus('Screen sharing started!')
      
      // Handle screen share end
      stream.getVideoTracks()[0].onended = () => {
        stopScreenShare()
      }
      
    } catch (error) {
      setStatus('Error: Could not access screen share')
      console.error('Screen share error:', error)
    }
  }

  async function stopScreenShare() {
    if (!roomRef.current || !isSharing) return
    
    try {
      // Unpublish video track
      const videoPublications = roomRef.current.localParticipant.getTrackPublications()
      for (const pub of videoPublications) {
        if (pub.kind === 'video' && pub.track) {
          await roomRef.current.localParticipant.unpublishTrack(pub.track.mediaStreamTrack)
        }
      }
      
      // Stop local stream
      if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop())
        setScreenStream(null)
      }
      
      setIsSharing(false)
      setStatus('Screen sharing stopped')
      
    } catch (error) {
      console.error('Error stopping screen share:', error)
    }
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
              <button 
                onClick={isSharing ? stopScreenShare : startScreenShare} 
                className={isSharing ? 'sharing' : ''}
              >
                {isSharing ? '🛑 Stop Share' : '📺 Share Screen'}
              </button>
              <button onClick={leaveLiveKit}>Leave Room</button>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={stopVoiceChat}>Stop Voice Chat</button>
          </div>
        </div>
      )}

      <audio ref={localAudioRef} autoPlay muted />
      
      {/* Video Display Section */}
      {(isSharing || remoteVideoStreams.size > 0) && (
        <div className="video-container" ref={videoContainerRef}>
          <h3>Screen Shares</h3>
          <div className="video-grid">
            {/* Local screen share */}
            {isSharing && screenStream && (
              <div className="video-item">
                <video 
                  autoPlay 
                  muted 
                  playsInline
                  ref={(el) => {
                    if (el && screenStream) el.srcObject = screenStream
                  }}
                />
                <div className="video-label">Your Screen</div>
              </div>
            )}
            
            {/* Remote screen shares */}
            {Array.from(remoteVideoStreams.entries()).map(([participantId, stream]) => (
              <div key={participantId} className="video-item">
                <video 
                  autoPlay 
                  playsInline
                  ref={(el) => {
                    if (el && stream) el.srcObject = stream
                  }}
                />
                <div className="video-label">{participantId}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

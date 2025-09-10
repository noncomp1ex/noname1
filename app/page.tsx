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
  const [participants, setParticipants] = useState<Map<string, string>>(new Map())

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
    room.on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => {
      log(`Participant joined: ${p.identity}`)
      setParticipants(prev => new Map(prev.set(p.identity, p.name || p.identity)))
    })
    room.on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
      log(`Participant left: ${p.identity}`)
      setParticipants(prev => {
        const newMap = new Map(prev)
        newMap.delete(p.identity)
        return newMap
      })
      // Clean up remote video streams
      setRemoteVideoStreams(prev => {
        const newMap = new Map(prev)
        newMap.delete(p.identity)
        return newMap
      })
    })
    room.on(RoomEvent.TrackSubscribed, (track, pub, p) => {
      if (track.kind === 'audio') {
        // Only play audio from remote participants, not our own
        if (p.identity !== myPeerId) {
          const el = new Audio()
          el.autoplay = true
          el.srcObject = new MediaStream([track.mediaStreamTrack])
          el.play().catch(() => {})
        }
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

    // Add local participant
    setParticipants(prev => new Map(prev.set(myPeerId, displayName || myPeerId)))

    // Add existing remote participants
    room.remoteParticipants.forEach((participant) => {
      setParticipants(prev => new Map(prev.set(participant.identity, participant.name || participant.identity)))
    })

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
    setParticipants(new Map())
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
    setParticipants(new Map())
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
      
      // Publish video track directly with quality constraints
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
    <div className="app-container">
      <div className="sidebar">
        <div className="logo">
          <h1>noname1</h1>
          <div className="logo-accent"></div>
        </div>
        
        <div className="status-card">
          <div className="status-indicator"></div>
          <span className="status-text">{status}</span>
        </div>
      </div>

      <div className="main-content">
        <div className="controls-section">

          {!localStream ? (
            <div className="start-section">
              <button className="start-btn" onClick={startVoiceChat}>
                <span>Start Voice Chat</span>
                <div className="btn-glow"></div>
              </button>
            </div>
          ) : (
            <div className="controls-grid">
              <div className="room-section">
                <div className="input-group">
                  <input 
                    type="text" 
                    placeholder="Room ID" 
                    value={roomId} 
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRoomId(e.target.value)} 
                    className="room-input"
                  />
                  <input 
                    value={displayName} 
                    onChange={e => setDisplayName(e.target.value)} 
                    placeholder="Your name" 
                    className="name-input"
                  />
                  <button 
                    onClick={joinLiveKit} 
                    disabled={!roomId.trim() || isInCall}
                    className={`join-btn ${isInCall ? 'active' : ''}`}
                  >
                    {isInCall ? 'In Room' : 'Join'}
                    <div className="btn-particles"></div>
                  </button>
                </div>
              </div>

              {isInCall && (
                <div className="action-buttons">
                  <button 
                    onClick={toggleMute} 
                    className={`action-btn mute-btn ${isMuted ? 'muted' : ''}`}
                  >
                    <span>{isMuted ? '🔇' : '🎤'}</span>
                    <div className="btn-ripple"></div>
                  </button>
                  <button 
                    onClick={isSharing ? stopScreenShare : startScreenShare} 
                    className={`action-btn share-btn ${isSharing ? 'sharing' : ''}`}
                  >
                    <span>{isSharing ? '🛑' : '📺'}</span>
                    <div className="btn-ripple"></div>
                  </button>
                  <button 
                    onClick={leaveLiveKit}
                    className="action-btn leave-btn"
                  >
                    <span>🚪 Exit</span>
                    <div className="btn-ripple"></div>
                  </button>
                </div>
              )}

              <div className="stop-section">
                <button 
                  onClick={stopVoiceChat}
                  className="stop-btn"
                >
                  Stop Voice Chat
                  <div className="btn-glow"></div>
                </button>
              </div>
            </div>
          )}
        </div>

      <audio ref={localAudioRef} autoPlay muted />
      
        {/* Participants List */}
        {isInCall && participants.size > 0 && (
          <div className="participants-section">
            <h3 className="section-title">Participants</h3>
            <div className="participants-grid">
              {Array.from(participants.entries()).map(([participantId, participantName]) => (
                <div key={participantId} className="participant-card">
                  <div className="participant-avatar">
                    {participantName.charAt(0).toUpperCase()}
                  </div>
                  <div className="participant-info">
                    <span className="participant-name">{participantName}</span>
                    {participantId === myPeerId && <span className="you-badge">You</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {/* Video Display Section */}
        {(isSharing || remoteVideoStreams.size > 0) && (
          <div className="video-section" ref={videoContainerRef}>
            <h3 className="section-title">Screen Shares</h3>
            <div className="video-grid">
              {/* Local screen share */}
              {isSharing && screenStream && (
                <div className="video-card">
                  <video 
                    autoPlay 
                    muted 
                    playsInline
                    ref={(el) => {
                      if (el && screenStream) el.srcObject = screenStream
                    }}
                  />
                  <div className="video-overlay">
                    <span className="video-label">Your Screen</span>
                  </div>
                </div>
              )}
              
              {/* Remote screen shares */}
              {Array.from(remoteVideoStreams.entries()).map(([participantId, stream]) => (
                <div key={participantId} className="video-card">
                  <video 
                    autoPlay 
                    playsInline
                    ref={(el) => {
                      if (el && stream) el.srcObject = stream
                    }}
                  />
                  <div className="video-overlay">
                    <span className="video-label">{participantId}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

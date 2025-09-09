'use client'

import { useState, useEffect, useRef } from 'react'
import Peer, { MediaConnection } from 'peerjs'

interface VoiceChatProps {}

export default function VoiceChat() {
  const [isMuted, setIsMuted] = useState(false)
  const [isInCall, setIsInCall] = useState(false)
  const [roomId, setRoomId] = useState('')
  const [status, setStatus] = useState('Ready to start')
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [isHost, setIsHost] = useState(false)

  const localAudioRef = useRef<HTMLAudioElement>(null)
  const remoteAudioRef = useRef<HTMLAudioElement>(null)
  const peerRef = useRef<Peer | null>(null)
  const currentCallRef = useRef<MediaConnection | null>(null)

  useEffect(() => {
    if (localAudioRef.current && localStream) {
      localAudioRef.current.srcObject = localStream
    }
  }, [localStream])

  useEffect(() => {
    if (remoteAudioRef.current && remoteStream) {
      remoteAudioRef.current.srcObject = remoteStream
    }
  }, [remoteStream])

  const startVoiceChat = async () => {
    try {
      setStatus('Requesting microphone access...')
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      })
      setLocalStream(stream)
      setStatus('Microphone access granted - Ready to join a room')
    } catch (error) {
      console.error('Error accessing microphone:', error)
      setStatus('Error: Could not access microphone')
    }
  }

  const joinRoom = async () => {
    if (!roomId.trim() || !localStream) return

    setStatus('Connecting...')

    // Try to become host by claiming the roomId as our Peer ID
    const tryHost = new Peer(roomId.trim(), { debug: 2 })
    peerRef.current = tryHost

    const setupHostHandlers = () => {
      if (!peerRef.current) return
      setIsHost(true)
      setIsInCall(true)
      setStatus('Room created. Waiting for other user to join...')

      peerRef.current.on('call', (call: MediaConnection) => {
        currentCallRef.current = call
        call.answer(localStream!)
        call.on('stream', (remote: MediaStream) => {
          setRemoteStream(remote)
          setStatus('Connected!')
        })
        call.on('close', () => {
          setStatus('Peer disconnected')
          setRemoteStream(null)
        })
        call.on('error', () => setStatus('Call error'))
      })
    }

    const connectAsGuest = () => {
      const guestPeer = new Peer({ debug: 2 })
      peerRef.current = guestPeer

      guestPeer.on('open', () => {
        setIsHost(false)
        setIsInCall(true)
        setStatus('Joining room...')
        const call = guestPeer.call(roomId.trim(), localStream!)
        if (!call) {
          setStatus('Unable to call host. Is the host online?')
          return
        }
        currentCallRef.current = call
        call.on('stream', (remote: MediaStream) => {
          setRemoteStream(remote)
          setStatus('Connected!')
        })
        call.on('close', () => {
          setStatus('Peer disconnected')
          setRemoteStream(null)
        })
        call.on('error', () => setStatus('Call error'))
      })

      guestPeer.on('error', () => setStatus('Peer connection error'))
    }

    tryHost.on('open', setupHostHandlers)

    // If ID is taken, we are not the host → join as guest
    tryHost.on('error', (err: any) => {
      if (err?.type === 'unavailable-id' || /unavailable/i.test(String(err))) {
        tryHost.destroy()
        connectAsGuest()
      } else {
        setStatus('Peer error')
      }
    })
  }

  const leaveRoom = () => {
    setIsInCall(false)
    setIsHost(false)
    setStatus('Left the room')
    if (currentCallRef.current) {
      try { currentCallRef.current.close() } catch {}
      currentCallRef.current = null
    }
    if (peerRef.current) {
      try { peerRef.current.destroy() } catch {}
      peerRef.current = null
    }
    setRemoteStream(null)
  }

  // PeerJS handles signaling under the hood; no manual SDP/ICE handling needed

  const toggleMute = () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0]
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled
        setIsMuted(!audioTrack.enabled)
      }
    }
  }

  const stopVoiceChat = () => {
    if (localStream) {
      localStream.getTracks().forEach((track: MediaStreamTrack) => track.stop())
      setLocalStream(null)
    }
    if (currentCallRef.current) {
      try { currentCallRef.current.close() } catch {}
      currentCallRef.current = null
    }
    if (peerRef.current) {
      try { peerRef.current.destroy() } catch {}
      peerRef.current = null
    }
    setIsInCall(false)
    setIsHost(false)
    setStatus('Voice chat stopped')
  }

  return (
    <div className="container">
      <h1>🎤 P2P Voice Chat</h1>
      
      <div className="status">{status}</div>

      {!localStream ? (
        <div className="controls">
          <button onClick={startVoiceChat}>
            Start Voice Chat
          </button>
        </div>
      ) : (
        <div className="controls">
          <div className="room-input">
            <input
              type="text"
              placeholder="Enter room ID (e.g., 'room123')"
              value={roomId}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRoomId(e.target.value)}
            />
            <button onClick={joinRoom} disabled={!roomId.trim() || isInCall}>
              {isInCall ? 'In Room' : 'Join Room'}
            </button>
          </div>

          {isInCall && (
            <>
              <button 
                onClick={toggleMute} 
                className={isMuted ? 'muted' : ''}
              >
                {isMuted ? '🔇 Unmute' : '🎤 Mute'}
              </button>
              <button onClick={leaveRoom}>
                Leave Room
              </button>
            </>
          )}

          <button onClick={stopVoiceChat}>
            Stop Voice Chat
          </button>
        </div>
      )}

      {/* Instructions */}
      <div style={{ marginTop: '2rem', fontSize: '0.9rem', opacity: 0.8 }}>
        <p><strong>How to use:</strong></p>
        <p>1. Click "Start Voice Chat" and allow microphone access</p>
        <p>2. Enter a room ID (e.g., "room123") and click "Join Room"</p>
        <p>3. Share the same room ID with your friend</p>
        <p>4. Your friend joins the same room ID from their device</p>
        <p>5. You'll be connected directly via P2P!</p>
      </div>

      {/* Hidden audio elements for playback */}
      <audio ref={localAudioRef} autoPlay muted />
      <audio ref={remoteAudioRef} autoPlay />
    </div>
  )
}

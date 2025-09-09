'use client'

import { useState, useEffect, useRef } from 'react'

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
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null)
  const dataChannelRef = useRef<RTCDataChannel | null>(null)

  const iceServers = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    ]
  }

  // Simple signaling using localStorage and storage events
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === `voice-chat-${roomId}` && e.newValue) {
        const data = JSON.parse(e.newValue)
        handleSignalingData(data)
      }
    }

    window.addEventListener('storage', handleStorageChange)
    return () => window.removeEventListener('storage', handleStorageChange)
  }, [roomId])

  const sendSignalingData = (data: any) => {
    if (roomId) {
      localStorage.setItem(`voice-chat-${roomId}`, JSON.stringify({
        ...data,
        timestamp: Date.now(),
        sender: 'peer'
      }))
    }
  }

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

  const handleSignalingData = async (data: any) => {
    if (data.sender === 'peer') return // Ignore our own messages

    switch (data.type) {
      case 'offer':
        await handleOffer(data.offer)
        break
      case 'answer':
        await handleAnswer(data.answer)
        break
      case 'ice-candidate':
        await handleIceCandidate(data.candidate)
        break
      case 'user-joined':
        if (isHost) {
          setStatus('Another user joined, creating offer...')
          await createOffer()
        }
        break
    }
  }

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

    const roomKey = `voice-chat-${roomId.trim()}`
    const existingData = localStorage.getItem(roomKey)
    
    if (existingData) {
      // Room exists, join as participant
      setIsHost(false)
      setStatus('Joining existing room...')
      sendSignalingData({ type: 'user-joined' })
    } else {
      // Create new room as host
      setIsHost(true)
      setStatus('Created new room - waiting for others to join...')
    }
    
    setIsInCall(true)
  }

  const leaveRoom = () => {
    if (roomId) {
      localStorage.removeItem(`voice-chat-${roomId}`)
    }
    setIsInCall(false)
    setIsHost(false)
    setStatus('Left the room')
    closePeerConnection()
  }

  const createPeerConnection = () => {
    const peerConnection = new RTCPeerConnection(iceServers)
    
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignalingData({
          type: 'ice-candidate',
          candidate: event.candidate
        })
      }
    }

    peerConnection.ontrack = (event) => {
      setRemoteStream(event.streams[0])
      setStatus('Connected to other user!')
    }

    if (localStream) {
      localStream.getTracks().forEach((track: MediaStreamTrack) => {
        peerConnection.addTrack(track, localStream)
      })
    }

    peerConnectionRef.current = peerConnection
  }

  const createOffer = async () => {
    createPeerConnection()
    const offer = await peerConnectionRef.current!.createOffer()
    await peerConnectionRef.current!.setLocalDescription(offer)
    sendSignalingData({
      type: 'offer',
      offer: offer
    })
    setStatus('Sent offer to other user')
  }

  const handleOffer = async (offer: RTCSessionDescriptionInit) => {
    createPeerConnection()
    await peerConnectionRef.current!.setRemoteDescription(offer)
    const answer = await peerConnectionRef.current!.createAnswer()
    await peerConnectionRef.current!.setLocalDescription(answer)
    sendSignalingData({
      type: 'answer',
      answer: answer
    })
    setStatus('Sent answer to other user')
  }

  const handleAnswer = async (answer: RTCSessionDescriptionInit) => {
    if (peerConnectionRef.current) {
      await peerConnectionRef.current.setRemoteDescription(answer)
    }
  }

  const handleIceCandidate = async (candidate: RTCIceCandidateInit) => {
    if (peerConnectionRef.current) {
      await peerConnectionRef.current.addIceCandidate(candidate)
    }
  }

  const closePeerConnection = () => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close()
      peerConnectionRef.current = null
    }
    setRemoteStream(null)
  }

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
    closePeerConnection()
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

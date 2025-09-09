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

    // Generate a unique peer ID
    const peerId = `peer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    
    try {
      // Fetch TURN servers
      const turnResponse = await fetch('/api/turn')
      const turnData = await turnResponse.json()
      
      // Check if room exists and join
      const response = await fetch('/api/signaling', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'join', roomId: roomId.trim(), peerId })
      })
      
      const roomData = await response.json()
      
      if (roomData.isHost) {
        // We are the host
        setIsHost(true)
        setIsInCall(true)
        setStatus('Room created. Waiting for other user to join...')
        
        // Create peer as host
        const hostPeer = new Peer(peerId, { 
          debug: 2,
          config: {
            iceServers: [
              // Optimized STUN servers (max 3)
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' },
              { urls: 'stun:stun2.l.google.com:19302' },
              // Dynamic TURN servers
              ...turnData.turnServers
            ]
          }
        })
        peerRef.current = hostPeer

        hostPeer.on('open', () => {
          setStatus('Room created. Waiting for other user to join...')
        })

        hostPeer.on('call', (call: MediaConnection) => {
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
          call.on('error', (err: any) => {
            console.error('Call error:', err)
            setStatus('Call error: ' + err.message)
          })
          
          // Monitor connection state
          call.peerConnection.oniceconnectionstatechange = () => {
            console.log('ICE connection state:', call.peerConnection.iceConnectionState)
            if (call.peerConnection.iceConnectionState === 'failed') {
              setStatus('Connection failed - trying alternative servers...')
              // Try to restart ICE gathering
              call.peerConnection.restartIce()
            } else if (call.peerConnection.iceConnectionState === 'connected') {
              setStatus('Connected!')
            } else if (call.peerConnection.iceConnectionState === 'checking') {
              setStatus('Checking connection...')
            } else if (call.peerConnection.iceConnectionState === 'completed') {
              setStatus('Connected!')
            }
          }
          
          // Monitor ICE gathering state
          call.peerConnection.onicegatheringstatechange = () => {
            console.log('ICE gathering state:', call.peerConnection.iceGatheringState)
            if (call.peerConnection.iceGatheringState === 'gathering') {
              setStatus('Gathering connection candidates...')
            }
          }
        })

        hostPeer.on('error', (err: any) => {
          console.error('Host peer error:', err)
          setStatus('Host connection error: ' + err.message)
          
          // Try to recover by destroying and recreating the peer
          if (peerRef.current) {
            peerRef.current.destroy()
          }
          
          setTimeout(() => {
            if (!currentCallRef.current) {
              setStatus('Retrying host connection...')
              // Recreate host peer
              const retryHostPeer = new Peer(peerId, { 
                debug: 2,
                config: { 
                  iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:stun2.l.google.com:19302' }
                  ]
                }
              })
              peerRef.current = retryHostPeer
              
              retryHostPeer.on('open', () => {
                setStatus('Host reconnected - waiting for calls...')
              })
              
              retryHostPeer.on('call', (call: MediaConnection) => {
                currentCallRef.current = call
                call.answer(localStream!)
                call.on('stream', (remote: MediaStream) => {
                  setRemoteStream(remote)
                  setStatus('Connected!')
                })
                call.on('close', () => {
                  setStatus('Call ended')
                  setRemoteStream(null)
                })
                call.on('error', (callErr: any) => {
                  console.error('Retry call error:', callErr)
                  setStatus('Call error: ' + callErr.message)
                })
              })
              
              retryHostPeer.on('error', (retryErr: any) => {
                console.error('Retry host peer error:', retryErr)
                setStatus('Host retry failed - please refresh and try again')
              })
            }
          }, 2000)
        })

      } else {
        // We are a guest
        setIsHost(false)
        setIsInCall(true)
        setStatus('Joining room...')
        
        // Create peer as guest
        const guestPeer = new Peer(peerId, { 
          debug: 2,
          config: {
            iceServers: [
              // Optimized STUN servers (max 3)
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' },
              { urls: 'stun:stun2.l.google.com:19302' },
              // Dynamic TURN servers
              ...turnData.turnServers
            ]
          }
        })
        peerRef.current = guestPeer

        guestPeer.on('open', () => {
          setStatus('Calling host...')
          
          // Add timeout for connection
          const connectionTimeout = setTimeout(() => {
            if (!currentCallRef.current) {
              setStatus('Connection timeout - host may be offline')
              guestPeer.destroy()
            }
          }, 10000) // 10 second timeout
          
          const call = guestPeer.call(roomData.hostId, localStream!)
          if (!call) {
            setStatus('Unable to call host. Is the host online?')
            clearTimeout(connectionTimeout)
            return
          }
          currentCallRef.current = call
          
          call.on('stream', (remote: MediaStream) => {
            clearTimeout(connectionTimeout)
            setRemoteStream(remote)
            setStatus('Connected!')
          })
          call.on('close', () => {
            clearTimeout(connectionTimeout)
            setStatus('Peer disconnected')
            setRemoteStream(null)
          })
          call.on('error', (err: any) => {
            clearTimeout(connectionTimeout)
            console.error('Call error:', err)
            setStatus('Call error: ' + err.message)
          })
          
          // Monitor connection state
          call.peerConnection.oniceconnectionstatechange = () => {
            console.log('ICE connection state:', call.peerConnection.iceConnectionState)
            if (call.peerConnection.iceConnectionState === 'failed') {
              setStatus('Connection failed - trying alternative approach...')
              // Try to restart ICE gathering with different configuration
              setTimeout(() => {
                if (call.peerConnection.iceConnectionState === 'failed') {
                  call.peerConnection.restartIce()
                }
              }, 1000)
            } else if (call.peerConnection.iceConnectionState === 'connected') {
              clearTimeout(connectionTimeout)
              setStatus('Connected!')
            } else if (call.peerConnection.iceConnectionState === 'checking') {
              setStatus('Checking connection...')
            } else if (call.peerConnection.iceConnectionState === 'completed') {
              clearTimeout(connectionTimeout)
              setStatus('Connected!')
            }
          }
          
          // Monitor ICE gathering state
          call.peerConnection.onicegatheringstatechange = () => {
            console.log('ICE gathering state:', call.peerConnection.iceGatheringState)
            if (call.peerConnection.iceGatheringState === 'gathering') {
              setStatus('Gathering connection candidates...')
            }
          }
        })

        guestPeer.on('error', (err: any) => {
          console.error('Guest peer error:', err)
          setStatus('Connection error - retrying...')
          
          // Destroy the current peer and create a new one
          if (peerRef.current) {
            peerRef.current.destroy()
          }
          
          // Retry connection after a short delay with a new peer
          setTimeout(() => {
            if (!currentCallRef.current) {
              setStatus('Retrying with new connection...')
              // Create a new guest peer
              const retryPeer = new Peer({ 
                debug: 2,
                config: { 
                  iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:stun2.l.google.com:19302' }
                  ]
                }
              })
              peerRef.current = retryPeer
              
              retryPeer.on('open', () => {
                const retryCall = retryPeer.call(roomData.hostId, localStream!)
                if (retryCall) {
                  currentCallRef.current = retryCall
                  retryCall.on('stream', (remote: MediaStream) => {
                    setRemoteStream(remote)
                    setStatus('Connected on retry!')
                  })
                  retryCall.on('error', (retryErr: any) => {
                    console.error('Retry call error:', retryErr)
                    setStatus('Retry failed - please refresh and try again')
                  })
                }
              })
              
              retryPeer.on('error', (retryErr: any) => {
                console.error('Retry peer error:', retryErr)
                setStatus('Retry failed - please refresh and try again')
              })
            }
          }, 3000)
        })
      }
    } catch (error) {
      console.error('Signaling error:', error)
      setStatus('Failed to join room - trying fallback...')
      
      // Fallback: try with minimal STUN servers only
      try {
        const fallbackPeer = new Peer(peerId, { 
          debug: 2,
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' },
              { urls: 'stun:stun2.l.google.com:19302' }
            ]
          }
        })
        peerRef.current = fallbackPeer
        
        fallbackPeer.on('open', () => {
          setStatus('Fallback connection established')
        })
        
        fallbackPeer.on('call', (call: MediaConnection) => {
          currentCallRef.current = call
          call.answer(localStream!)
          call.on('stream', (remote: MediaStream) => {
            setRemoteStream(remote)
            setStatus('Connected via fallback!')
          })
          
          // Add connection monitoring for fallback
          call.peerConnection.oniceconnectionstatechange = () => {
            console.log('Fallback ICE state:', call.peerConnection.iceConnectionState)
            if (call.peerConnection.iceConnectionState === 'connected' || 
                call.peerConnection.iceConnectionState === 'completed') {
              setStatus('Connected via fallback!')
            }
          }
        })
        
        setIsInCall(true)
        setIsHost(true)
      } catch (fallbackError) {
        console.error('Fallback failed:', fallbackError)
        setStatus('Connection failed completely - try refreshing the page')
      }
    }
  }

  const leaveRoom = async () => {
    setIsInCall(false)
    setIsHost(false)
    setStatus('Left the room')
    
    // Notify signaling server
    if (roomId) {
      try {
        await fetch('/api/signaling', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'leave', roomId: roomId.trim(), peerId: peerRef.current?.id })
        })
      } catch (error) {
        console.error('Error leaving room:', error)
      }
    }
    
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

  const stopVoiceChat = async () => {
    if (localStream) {
      localStream.getTracks().forEach((track: MediaStreamTrack) => track.stop())
      setLocalStream(null)
    }
    
    // Notify signaling server
    if (roomId && peerRef.current) {
      try {
        await fetch('/api/signaling', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'leave', roomId: roomId.trim(), peerId: peerRef.current.id })
        })
      } catch (error) {
        console.error('Error leaving room:', error)
      }
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
          
          <button onClick={() => {
            console.log('Current connection state:', {
              isInCall,
              isHost,
              hasLocalStream: !!localStream,
              hasRemoteStream: !!remoteStream,
              peerId: peerRef.current?.id,
              callId: currentCallRef.current?.peer,
              iceConnectionState: currentCallRef.current?.peerConnection?.iceConnectionState,
              iceGatheringState: currentCallRef.current?.peerConnection?.iceGatheringState
            })
            setStatus('Debug info logged to console')
          }}>
            Debug Connection
          </button>
          
          <button onClick={() => {
            if (currentCallRef.current) {
              console.log('Restarting ICE gathering...')
              currentCallRef.current.peerConnection.restartIce()
              setStatus('Restarting connection...')
            }
          }}>
            Restart Connection
          </button>
          
          <button onClick={async () => {
            setStatus('Trying alternative connection method...')
            // Try with different TURN servers
            try {
              const altTurnResponse = await fetch('/api/turn')
              const altTurnData = await altTurnResponse.json()
              
              if (currentCallRef.current) {
                const pc = currentCallRef.current.peerConnection
                const config = pc.getConfiguration()
                config.iceServers = [
                  { urls: 'stun:stun.l.google.com:19302' },
                  { urls: 'stun:stun1.l.google.com:19302' },
                  ...altTurnData.turnServers
                ]
                pc.setConfiguration(config)
                pc.restartIce()
                setStatus('Trying alternative TURN servers...')
              }
            } catch (error) {
              console.error('Alternative connection failed:', error)
              setStatus('Alternative connection failed')
            }
          }}>
            Try Alternative TURN
          </button>
          
          <button onClick={() => {
            setStatus('Force reconnecting...')
            // Destroy current connection and restart
            if (peerRef.current) {
              peerRef.current.destroy()
            }
            if (currentCallRef.current) {
              currentCallRef.current.close()
            }
            setRemoteStream(null)
            setIsInCall(false)
            setIsHost(false)
            setStatus('Disconnected - please join room again')
          }}>
            Force Reconnect
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
        <br />
        <p><strong>Troubleshooting:</strong></p>
        <p>• If connection fails, try a different room ID</p>
        <p>• Check browser console for detailed error messages</p>
        <p>• Ensure both users have microphone access enabled</p>
        <p>• Try refreshing the page if connection gets stuck</p>
        <p>• Use "Debug Connection" button to see connection state</p>
        <p>• Use "Restart Connection" if connection gets stuck</p>
        <p>• Use "Try Alternative TURN" for cross-city connections</p>
        <p>• If TURN servers fail, the app will try STUN-only fallback</p>
        <p>• For cross-city connections, TURN servers are essential</p>
        <p>• Try opening two tabs on the same device first to test locally</p>
        <p>• If ICE connection state shows "failed", try alternative TURN servers</p>
      </div>

      {/* Hidden audio elements for playback */}
      <audio ref={localAudioRef} autoPlay muted />
      <audio ref={remoteAudioRef} autoPlay />
    </div>
  )
}

'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Peer, { MediaConnection } from 'peerjs'
import React from 'react'

interface VoiceChatProps {}

export default function VoiceChat() {
  const [isMuted, setIsMuted] = useState(false)
  const [isInCall, setIsInCall] = useState(false)
  const [roomId, setRoomId] = useState('')
  const [status, setStatus] = useState('Ready to start')
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [isHost, setIsHost] = useState(false)
  const [eventLog, setEventLog] = useState<string[]>([])
  const [displayName, setDisplayName] = useState('')
  const [peerList, setPeerList] = useState<Array<{id: string, name: string, role: string}>>([])
  const [hostId, setHostId] = useState<string>('')
  const [myPeerId, setMyPeerId] = useState<string>('')
  const [iceCandidates, setIceCandidates] = useState<any[]>([])
  const [turnLoading, setTurnLoading] = useState(false)
  const [turnDone, setTurnDone] = useState(false)
  const [reconnectLoading, setReconnectLoading] = useState(false)
  const [reconnectDone, setReconnectDone] = useState(false)
  const [currentMode, setCurrentMode] = useState<'Default' | 'Alternative TURN' | 'TURN-Only'>('Default')
  const [currentIceServers, setCurrentIceServers] = useState<any[]>([])

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
      
      const nameToSend = displayName.trim() || `Anonymous${Math.floor(Math.random()*1000)}`

      // Check if room exists and join
      const response = await fetch('/api/signaling', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'join', roomId: roomId.trim(), peerId, displayName: nameToSend })
      })
      
      const roomData = await response.json()
      
      if (roomData.isHost) {
        // We are the host
        setIsHost(true)
        setIsInCall(true)
        setStatus('Room created. Waiting for other user to join...')
        
        // Create peer as host with aggressive NAT traversal config
        const hostPeer = new Peer(peerId, { 
          debug: 2,
          config: {
            iceServers: [
              // More STUN servers for restrictive NATs
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' },
              { urls: 'stun:stun2.l.google.com:19302' },
              { urls: 'stun:stun3.l.google.com:19302' },
              { urls: 'stun:stun4.l.google.com:19302' },
              // Dynamic TURN servers
              ...turnData.turnServers
            ],
            iceCandidatePoolSize: 10,
            iceTransportPolicy: 'all'
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

        updateIceServers(hostPeer.options.config.iceServers, 'Default')

      } else {
        // We are a guest
        setIsHost(false)
        setIsInCall(true)
        setStatus('Joining room...')
        
        // Create peer as guest with aggressive NAT traversal config
        const guestPeer = new Peer(peerId, { 
          debug: 2,
          config: {
            iceServers: [
              // More STUN servers for restrictive NATs
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' },
              { urls: 'stun:stun2.l.google.com:19302' },
              { urls: 'stun:stun3.l.google.com:19302' },
              { urls: 'stun:stun4.l.google.com:19302' },
              // Dynamic TURN servers
              ...turnData.turnServers
            ],
            iceCandidatePoolSize: 10,
            iceTransportPolicy: 'all'
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

        updateIceServers(guestPeer.options.config.iceServers, 'Default')
      }
    } catch (error) {
      console.error('Signaling error:', error)
      setStatus('Failed to join room - trying fallback...')
      
      // Fallback: try with more STUN servers for restrictive NATs
      try {
        const fallbackPeer = new Peer(peerId, { 
          debug: 2,
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' },
              { urls: 'stun:stun2.l.google.com:19302' },
              { urls: 'stun:stun3.l.google.com:19302' },
              { urls: 'stun:stun4.l.google.com:19302' }
            ],
            iceCandidatePoolSize: 10,
            iceTransportPolicy: 'all'
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
        updateIceServers(fallbackPeer.options.config.iceServers, 'Default')
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

  // Helper to add to event log
  const logEvent = (msg: string) => setEventLog(log => [
    `[${new Date().toLocaleTimeString()}] ${msg}`,
    ...log.slice(0, 49)
  ])

  // Helper to update ICE server list and mode
  const updateIceServers = (servers: any[], mode: 'Default' | 'Alternative TURN' | 'TURN-Only') => {
    setCurrentIceServers(servers)
    setCurrentMode(mode)
    logEvent(`Switched to ${mode} mode. Using servers: ${servers.map(s => s.urls).join(', ')}`)
    setStatus(`Mode: ${mode}`)
  }

  // Poll peer list every 2s
  useEffect(() => {
    if (!roomId) return
    let cancelled = false
    async function pollPeers() {
      try {
        const res = await fetch('/api/signaling', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'get-room', roomId: roomId.trim() })
        })
        if (res.ok) {
          const data = await res.json()
          // Compose peer list with roles
          const peers: Array<{id: string, name: string, role: string}> = []
          if (data.host) peers.push({ id: data.host.id, name: data.host.name, role: 'Host' })
          if (data.guests) {
            for (const g of data.guests) {
              peers.push({ id: g.id, name: g.name, role: g.id === myPeerId ? 'You' : 'Guest' })
            }
          }
          setPeerList(peers)
        }
      } catch {}
      if (!cancelled) setTimeout(pollPeers, 2000)
    }
    pollPeers()
    return () => { cancelled = true }
  }, [roomId, myPeerId])

  // Log peer list changes
  const prevPeerList = useRef<Array<{id: string, name: string, role: string}>>([])
  useEffect(() => {
    if (prevPeerList.current.length) {
      const prevIds = prevPeerList.current.map(p => p.id)
      const currIds = peerList.map(p => p.id)
      const joined = peerList.filter(p => !prevIds.includes(p.id))
      const left = prevPeerList.current.filter(p => !currIds.includes(p.id))
      joined.forEach(p => logEvent(`Peer joined: ${p.name}`))
      left.forEach(p => logEvent(`Peer left: ${p.name}`))
    }
    prevPeerList.current = peerList
  }, [peerList])

  // Set myPeerId after joinRoom
  useEffect(() => {
    if (peerRef.current) {
      setMyPeerId(peerRef.current.id)
    }
  }, [peerRef.current?.id])

  // ICE candidate logging
  const addIceCandidate = (candidate: RTCIceCandidate) => {
    setIceCandidates(cands => [candidate, ...cands.slice(0, 19)])
    logEvent(`ICE candidate: ${candidate.candidate}`)
  }
  // Attach to peerConnection in call setup:
  // call.peerConnection.addEventListener('icecandidate', e => { if (e.candidate) addIceCandidate(e.candidate) })

  // Auto-leave on unload
  useEffect(() => {
    const handler = () => {
      if (roomId && myPeerId) {
        navigator.sendBeacon(
          '/api/signaling',
          JSON.stringify({ action: 'leave', roomId: roomId.trim(), peerId: myPeerId })
        )
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [roomId, myPeerId])

  // Improved TURN button
  const handleTurn = useCallback(async () => {
    setTurnLoading(true)
    setTurnDone(false)
    setStatus('Trying alternative connection method...')
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
      setTurnDone(true)
    } catch (error) {
      setStatus('Alternative connection failed')
    }
    setTurnLoading(false)
    setTimeout(() => setTurnDone(false), 2000)
  }, [])

  // Improved reconnect button
  const handleReconnect = useCallback(() => {
    setReconnectLoading(true)
    setReconnectDone(false)
    setStatus('Force reconnecting...')
    if (peerRef.current) peerRef.current.destroy()
    if (currentCallRef.current) currentCallRef.current.close()
    setRemoteStream(null)
    setIsInCall(false)
    setIsHost(false)
    setStatus('Disconnected - please join room again')
    setTimeout(() => {
      setReconnectLoading(false)
      setReconnectDone(true)
      setTimeout(() => setReconnectDone(false), 2000)
    }, 1000)
  }, [])

  // Improved Alternative TURN button
  const handleAltTurn = useCallback(async () => {
    setTurnLoading(true)
    setTurnDone(false)
    setStatus('Switching to alternative TURN servers...')
    try {
      const altTurnResponse = await fetch('/api/turn')
      const altTurnData = await altTurnResponse.json()
      const servers = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        ...altTurnData.turnServers
      ]
      if (currentCallRef.current) {
        const pc = currentCallRef.current.peerConnection
        const config = pc.getConfiguration()
        config.iceServers = servers
        pc.setConfiguration(config)
        pc.restartIce()
        updateIceServers(servers, 'Alternative TURN')
      }
      setTurnDone(true)
    } catch (error) {
      setStatus('Alternative TURN failed')
    }
    setTurnLoading(false)
    setTimeout(() => setTurnDone(false), 2000)
  }, [])

  // Improved TURN-Only button
  const handleTurnOnly = useCallback(async () => {
    setTurnLoading(true)
    setTurnDone(false)
    setStatus('Switching to TURN-Only mode...')
    try {
      const turnResponse = await fetch('/api/turn')
      const turnData = await turnResponse.json()
      const servers = [...turnData.turnServers]
      if (currentCallRef.current) {
        const pc = currentCallRef.current.peerConnection
        const config = pc.getConfiguration()
        config.iceServers = servers
        config.iceTransportPolicy = 'relay'
        pc.setConfiguration(config)
        pc.restartIce()
        updateIceServers(servers, 'TURN-Only')
      }
      setTurnDone(true)
    } catch (error) {
      setStatus('TURN-Only mode failed')
    }
    setTurnLoading(false)
    setTimeout(() => setTurnDone(false), 2000)
  }, [])

  // Improved Restart ICE button
  const handleRestartIce = useCallback(() => {
    setReconnectLoading(true)
    setReconnectDone(false)
    setStatus('Restarting ICE gathering...')
    if (currentCallRef.current) {
      currentCallRef.current.peerConnection.restartIce()
      logEvent('ICE gathering restarted')
    }
    setTimeout(() => {
      setReconnectLoading(false)
      setReconnectDone(true)
      setTimeout(() => setReconnectDone(false), 2000)
    }, 1000)
  }, [])

  // Improved Force Reconnect button
  const handleForceReconnect = useCallback(() => {
    setReconnectLoading(true)
    setReconnectDone(false)
    setStatus('Disconnecting and resetting...')
    if (peerRef.current) peerRef.current.destroy()
    if (currentCallRef.current) currentCallRef.current.close()
    setRemoteStream(null)
    setIsInCall(false)
    setIsHost(false)
    setStatus('Disconnected - please join room again')
    logEvent('Disconnected and reset')
    setTimeout(() => {
      setReconnectLoading(false)
      setReconnectDone(true)
      setTimeout(() => setReconnectDone(false), 2000)
    }, 1000)
  }, [])

  return (
    <div className="container">
      <h1>🎤 P2P Voice Chat</h1>
      
      {/* Status Panel */}
      <div style={{ background: '#222', color: '#fff', padding: '1rem', borderRadius: 8, marginBottom: 16 }}>
        <div><b>Room:</b> {roomId || '(none)'}</div>
        <div><b>Your Peer ID:</b> {myPeerId || '(not joined)'}</div>
        <div><b>Status:</b> {status}</div>
        <div><b>Role:</b> {isHost ? 'Host' : 'Guest'}</div>
        <div><b>Current Connection Mode:</b> {currentMode}</div>
        <div><b>ICE Servers in Use:</b></div>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: '0.9em' }}>
          {currentIceServers.map((s, i) => (
            <li key={i} style={{ color: s.urls.includes('turn:') ? '#ffb347' : '#b3e6ff' }}>
              {s.urls} {s.urls.includes('turn:') ? '(TURN)' : '(STUN)'}
            </li>
          ))}
        </ul>
        <div style={{ fontSize: '0.8em', color: '#aaa', marginTop: 4 }}>
          Note: If you refresh or close the tab without leaving, your old peer may remain in the list for a while.
        </div>
        <div style={{ marginTop: 8 }}>
          <b>ICE Candidates:</b>
          <ul style={{ maxHeight: 80, overflow: 'auto', fontSize: '0.8em' }}>
            {iceCandidates.map((c, i) => <li key={i}>{c.candidate}</li>)}
          </ul>
        </div>
        <div style={{ marginTop: 8 }}>
          <b>Event Log:</b>
          <ul style={{ maxHeight: 100, overflow: 'auto', fontSize: '0.8em' }}>
            {eventLog.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      </div>

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
            <input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Your display name" style={{ marginBottom: 8, padding: 6, borderRadius: 4, border: '1px solid #888', width: 200 }} />
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
          
          {/* Removed manual ICE/TURN/Reconnect buttons */}
        </div>
      )}

      {/* Instructions */}
      <div style={{ marginTop: '2rem', fontSize: '0.9rem', opacity: 0.8 }}>
        <b>Instructions:</b>
        <ul style={{ fontSize: '0.95em' }}>
          <li>Start voice chat and join a room with a unique ID.</li>
          <li>Share the room ID with your friend to connect.</li>
          <li>Use <b>Leave Room</b> to exit the call.</li>
          <li>If the connection fails, try refreshing the page or joining a different room.</li>
        </ul>
      </div>

      {/* Hidden audio elements for playback */}
      <audio ref={localAudioRef} autoPlay muted />
      <audio ref={remoteAudioRef} autoPlay />

      {/* Peers in Room */}
      <div style={{ margin: '1em 0', background: '#181c24', borderRadius: 8, padding: 12 }}>
        <b>Peers in Room:</b>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {peerList.map(p => (
            <li key={p.id} style={{ margin: '0.5em 0', padding: 8, background: p.role==='You' ? '#2e7d32' : p.role==='Host' ? '#1976d2' : '#333', color: '#fff', borderRadius: 6 }}>
              <span style={{ fontWeight: 700, fontSize: '1.1em' }}>{p.name}</span>
              <span style={{ marginLeft: 8, fontSize: '0.95em', opacity: 0.8 }}>({p.role})</span>
              <div style={{ fontSize: '0.8em', color: '#bbb', marginTop: 2 }}>ID: {p.id}</div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

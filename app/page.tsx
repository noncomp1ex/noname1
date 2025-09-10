'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
// Remove PeerJS import
// import Peer, { MediaConnection } from 'peerjs'
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
  const [peerList, setPeerList] = useState<Array<{id: string, name: string, role: string}>>([])
  const [hostId, setHostId] = useState<string>('')
  const [myPeerId, setMyPeerId] = useState<string>('')
  const [iceCandidates, setIceCandidates] = useState<any[]>([])
  const [currentMode, setCurrentMode] = useState<'Default' | 'TURN-Only'>('Default')
  const [currentIceServers, setCurrentIceServers] = useState<any[]>([])
  const [displayName, setDisplayName] = useState('')
  const [connectionState, setConnectionState] = useState<string>('-')
  const [iceState, setIceState] = useState<string>('-')
  const [signalingState, setSignalingState] = useState<string>('-')
  const [selectedPair, setSelectedPair] = useState<{ local?: string, remote?: string, protocol?: string, candidateType?: string }>({})

  const localAudioRef = useRef<HTMLAudioElement>(null)
  const remoteAudioRef = useRef<HTMLAudioElement>(null)

  // Native WebRTC refs
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const remoteStreamRef = useRef<MediaStream | null>(null)
  const pullIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const targetPeerRef = useRef<string>('')

  const logEvent = (msg: string) => setEventLog(log => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...log.slice(0, 49)])

  useEffect(() => {
    if (localAudioRef.current && localStream) localAudioRef.current.srcObject = localStream
  }, [localStream])
  useEffect(() => {
    if (remoteAudioRef.current && remoteStream) remoteAudioRef.current.srcObject = remoteStream
  }, [remoteStream])

  const addIceCandidate = (candidate: RTCIceCandidate) => {
    setIceCandidates(cands => [candidate, ...cands.slice(0, 19)])
    logEvent(`ICE: ${candidate.candidate}`)
  }

  const teardownPc = () => {
    if (pcRef.current) {
      try { pcRef.current.onicecandidate = null; pcRef.current.ontrack = null; pcRef.current.close() } catch {}
    }
    pcRef.current = null
    remoteStreamRef.current = null
    setRemoteStream(null)
  }

  const buildIceServers = async (relayOnly = false) => {
    // Prefer environment-provided TURN (stable) if set
    const ENV_TURN_URL = process.env.NEXT_PUBLIC_TURN_URL
    const ENV_TURN_USERNAME = process.env.NEXT_PUBLIC_TURN_USERNAME
    const ENV_TURN_CREDENTIAL = process.env.NEXT_PUBLIC_TURN_CREDENTIAL

    let servers: any[] = []
    if (ENV_TURN_URL && ENV_TURN_USERNAME && ENV_TURN_CREDENTIAL) {
      const turnEntry = { urls: ENV_TURN_URL, username: ENV_TURN_USERNAME, credential: ENV_TURN_CREDENTIAL }
      const baseStun = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
      ]
      servers = relayOnly ? [turnEntry] : [...baseStun, turnEntry]
    } else {
      // Fallback to free TURN list (less reliable)
      const turnRes = await fetch('/api/turn')
      const turnData = await turnRes.json()
      const baseStun = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
      ]
      servers = relayOnly ? [...turnData.turnServers] : [...baseStun, ...turnData.turnServers]
    }

    setCurrentIceServers(servers)
    setCurrentMode(relayOnly ? 'TURN-Only' : 'Default')
    return servers
  }

  const createPc = async (relayOnly = false) => {
    teardownPc()
    const servers = await buildIceServers(relayOnly)
    const pc = new RTCPeerConnection({ iceServers: servers, iceCandidatePoolSize: 10, iceTransportPolicy: relayOnly ? 'relay' : 'all' })

    // Basic state hooks
    pc.onconnectionstatechange = () => setConnectionState(pc.connectionState)
    pc.onsignalingstatechange = () => setSignalingState(pc.signalingState)
    pc.oniceconnectionstatechange = () => setIceState(pc.iceConnectionState)

    pc.onicecandidate = async (e) => {
      if (e.candidate && roomId && targetPeerRef.current) {
        addIceCandidate(e.candidate)
        await fetch('/api/signaling', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'candidate', roomId: roomId.trim(), to: targetPeerRef.current, from: myPeerId, candidate: e.candidate })
        })
      }
    }
    pc.ontrack = (e) => {
      if (!remoteStreamRef.current) remoteStreamRef.current = new MediaStream()
      const [stream] = e.streams
      setRemoteStream(stream)
    }
    if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream))
    pcRef.current = pc
    return pc
  }

  const startPullLoop = (room: string, forPeer: string) => {
    if (pullIntervalRef.current) clearInterval(pullIntervalRef.current)
    pullIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/signaling', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'pull', roomId: room.trim(), forPeer })
        })
        if (!res.ok) return
        const data = await res.json()
        const messages = data.messages || []
        for (const msg of messages) {
          if (!pcRef.current) continue
          if (msg.type === 'offer') {
            logEvent('Received offer')
            await pcRef.current.setRemoteDescription(new RTCSessionDescription(msg.sdp))
            const answer = await pcRef.current.createAnswer()
            await pcRef.current.setLocalDescription(answer)
            await fetch('/api/signaling', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'answer', roomId: room.trim(), to: msg.from, from: myPeerId, sdp: answer })
            })
            targetPeerRef.current = msg.from
          } else if (msg.type === 'answer') {
            logEvent('Received answer')
            await pcRef.current.setRemoteDescription(new RTCSessionDescription(msg.sdp))
          } else if (msg.type === 'candidate') {
            try { await pcRef.current.addIceCandidate(new RTCIceCandidate(msg.candidate)) } catch {}
          }
        }
      } catch {}
    }, 1000)
  }

  const startVoiceChat = async () => {
    try {
      setStatus('Requesting microphone access...')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      setLocalStream(stream)
      setStatus('Microphone access granted - Ready to join a room')
    } catch (error) {
      console.error('Mic error:', error)
      setStatus('Error: Could not access microphone')
    }
  }

  const joinRoom = async () => {
    if (!roomId.trim() || !localStream) return
    setStatus('Connecting...')

    const peerId = `peer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    setMyPeerId(peerId)
    const nameToSend = displayName.trim() || `Anonymous${Math.floor(Math.random()*1000)}`

    try {
      const turnRes = await fetch('/api/turn'); await turnRes.json()
      const joinRes = await fetch('/api/signaling', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'join', roomId: roomId.trim(), peerId, displayName: nameToSend })
      })
      const roomData = await joinRes.json()

      if (roomData.isHost) {
        setIsHost(true); setIsInCall(true)
        await createPc(false)
        startPullLoop(roomId, peerId)
        setStatus('Room created. Waiting for others to join...')
      } else {
        setIsHost(false); setIsInCall(true)
        const pc = await createPc(false)
        targetPeerRef.current = roomData.hostId
        const offer = await pc.createOffer({ offerToReceiveAudio: true })
        await pc.setLocalDescription(offer)
        await fetch('/api/signaling', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'offer', roomId: roomId.trim(), to: roomData.hostId, from: peerId, sdp: offer })
        })
        startPullLoop(roomId, peerId)
        setStatus('Calling host...')
      }

      const attachIceStateHandlers = () => {
        if (!pcRef.current) return
        pcRef.current.oniceconnectionstatechange = async () => {
          const state = pcRef.current?.iceConnectionState
          logEvent(`ICE state: ${state}`)
          if (state === 'failed' || state === 'disconnected') {
            if (currentMode !== 'TURN-Only') {
              logEvent('Falling back to TURN-Only...')
              const wasHost = isHost
              const target = targetPeerRef.current || (wasHost ? '' : roomData.hostId)
              try {
                await createPc(true)
                if (!wasHost) {
                  const offer = await pcRef.current!.createOffer({ offerToReceiveAudio: true })
                  await pcRef.current!.setLocalDescription(offer)
                  await fetch('/api/signaling', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'offer', roomId: roomId.trim(), to: target, from: myPeerId, sdp: offer })
                  })
                }
              } catch {}
            }
          } else if (state === 'connected' || state === 'completed') {
            setStatus('Connected!')
          }
        }
      }
      attachIceStateHandlers()
    } catch (e) {
      console.error(e)
      setStatus('Connection failed. Please refresh or try another network.')
    }
  }

  const leaveRoom = async () => {
    if (roomId && myPeerId) {
      await fetch('/api/signaling', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'leave', roomId: roomId.trim(), peerId: myPeerId }) })
    }
    if (pullIntervalRef.current) clearInterval(pullIntervalRef.current)
    targetPeerRef.current = ''
    teardownPc()
    setIsInCall(false)
    setIsHost(false)
    setStatus('Left the room')
  }

  const toggleMute = () => {
    if (!localStream) return
    const audioTrack = localStream.getAudioTracks()[0]
    if (!audioTrack) return
    audioTrack.enabled = !audioTrack.enabled
    setIsMuted(!audioTrack.enabled)
  }

  const stopVoiceChat = () => {
    if (localStream) {
      localStream.getTracks().forEach(t => t.stop())
      setLocalStream(null)
    }
    teardownPc()
    setIsInCall(false)
    setIsHost(false)
    setStatus('Voice chat stopped')
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
          const peers: Array<{id: string, name: string, role: string}> = []
          if (data.host) {
            setHostId(data.host.id)
            const isYou = data.host.id === myPeerId
            peers.push({ id: data.host.id, name: data.host.name, role: isYou ? 'Host • You' : 'Host' })
          }
          if (data.guests) {
            for (const g of data.guests) {
              const isYou = g.id === myPeerId
              peers.push({ id: g.id, name: g.name, role: isYou ? 'You' : 'Guest' })
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

  useEffect(() => {
    const handler = () => {
      if (roomId && myPeerId) {
        navigator.sendBeacon('/api/signaling', JSON.stringify({ action: 'leave', roomId: roomId.trim(), peerId: myPeerId }))
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [roomId, myPeerId])

  // Periodically read stats to find selected candidate pair
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null
    const poll = async () => {
      try {
        const pc = pcRef.current
        if (!pc) return
        const stats = await pc.getStats()
        let pairs: any = {}
        const candidates: Record<string, any> = {}
        stats.forEach((report: any) => {
          if (report.type === 'candidate-pair') {
            pairs[report.id] = report
          } else if (report.type === 'remote-candidate' || report.type === 'local-candidate') {
            candidates[report.id] = report
          }
        })
        // Find selected candidate pair
        const selected = Object.values(pairs).find((p: any) => p && (p as any).selected)
        if (selected) {
          const local = candidates[(selected as any).localCandidateId]
          const remote = candidates[(selected as any).remoteCandidateId]
          setSelectedPair({
            local: local ? `${local.ip || local.address}:${local.port}` : undefined,
            remote: remote ? `${remote.ip || remote.address}:${remote.port}` : undefined,
            protocol: (selected as any).protocol || local?.protocol,
            candidateType: remote?.candidateType || local?.candidateType
          })
        }
      } catch {}
    }
    timer = setInterval(poll, 1500)
    return () => { if (timer) clearInterval(timer) }
  }, [])

  return (
    <div className="container">
      <h1>🎤 P2P Voice Chat</h1>
      
      {/* Status Panel */}
      <div style={{ background: 'rgba(0,0,0,0.35)', color: '#fff', padding: '1rem', borderRadius: 12, marginBottom: 16, border: '1px solid rgba(255,255,255,0.15)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div><b>Room:</b> {roomId || '(none)'}</div>
          <div><b>Your ID:</b> {myPeerId || '(not joined)'}</div>
          <div><b>Role:</b> {isHost ? 'Host' : isInCall ? 'Guest' : '-'}</div>
          <div><b>Mode:</b> {currentMode}</div>
          <div><b>Conn:</b> {connectionState}</div>
          <div><b>ICE:</b> {iceState}</div>
          <div><b>Signal:</b> {signalingState}</div>
        </div>
        {selectedPair.remote && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Selected Path</div>
            <div style={{ fontSize: 12, opacity: 0.9 }}>
              Local: {selectedPair.local} → Remote: {selectedPair.remote} ({selectedPair.protocol || 'udp'} / {selectedPair.candidateType || 'unknown'})
            </div>
          </div>
        )}
        <div style={{ marginTop: 10 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>ICE Servers</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {currentIceServers.map((s, i) => (
              <span key={i} style={{ fontSize: 12, padding: '4px 8px', borderRadius: 999, background: s.urls.includes('turn:') ? 'rgba(255,179,71,0.25)' : 'rgba(179,230,255,0.2)', border: '1px solid rgba(255,255,255,0.2)' }}>
                {s.urls} {s.urls.includes('turn:') ? '• TURN' : '• STUN'}
              </span>
            ))}
          </div>
        </div>
        <div style={{ marginTop: 10 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Recent ICE Candidates</div>
          <ul style={{ maxHeight: 90, overflow: 'auto', fontSize: 12, margin: 0, paddingLeft: 16 }}>
            {iceCandidates.map((c, i) => <li key={i} style={{ opacity: 0.85 }}>{c.candidate}</li>)}
          </ul>
        </div>
        <div style={{ marginTop: 10 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Events</div>
          <ul style={{ maxHeight: 110, overflow: 'auto', fontSize: 12, margin: 0, paddingLeft: 16 }}>
            {eventLog.map((e, i) => <li key={i} style={{ opacity: 0.9 }}>{e}</li>)}
          </ul>
        </div>
      </div>

      {!localStream ? (
        <div className="controls">
          <button onClick={startVoiceChat}>Start Voice Chat</button>
        </div>
      ) : (
        <div className="controls" style={{ gap: 8 }}>
          <div className="room-input" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input type="text" placeholder="Enter room ID (e.g., 'room123')" value={roomId} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRoomId(e.target.value)} />
            <input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Your display name" />
            <button onClick={joinRoom} disabled={!roomId.trim() || isInCall}>{isInCall ? 'In Room' : 'Join Room'}</button>
          </div>

          {isInCall && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={toggleMute} className={isMuted ? 'muted' : ''}>{isMuted ? '🔇 Unmute' : '🎤 Mute'}</button>
              <button onClick={leaveRoom}>Leave Room</button>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={stopVoiceChat}>Stop Voice Chat</button>
            <button onClick={() => {
              console.log('Current connection state:', {
                isInCall,
                isHost,
                hasLocalStream: !!localStream,
                hasRemoteStream: !!remoteStream,
                peerId: myPeerId,
                iceConnectionState: pcRef.current?.iceConnectionState,
                iceGatheringState: pcRef.current?.iceGatheringState
              })
              setStatus('Debug info logged to console')
            }}>Debug Connection</button>
          </div>
        </div>
      )}

      {/* Peers in Room - compact chips */}
      <div style={{ margin: '12px 0', background: 'rgba(0,0,0,0.25)', borderRadius: 12, padding: 12, border: '1px solid rgba(255,255,255,0.15)' }}>
        <div style={{ fontWeight: 700, marginBottom: 8, color: '#fff' }}>Peers</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {peerList.length === 0 && (
            <span style={{ fontSize: 13, opacity: 0.8, color: '#ddd' }}>(none)</span>
          )}
          {peerList.map(p => (
            <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 999, background: 'rgba(255,255,255,0.08)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)' }}>
              <span style={{ fontWeight: 700 }}>{p.name}</span>
              <span style={{ fontSize: 12, opacity: 0.8 }}>• {p.role}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Instructions */}
      <div style={{ marginTop: '1rem', fontSize: '0.9rem', opacity: 0.9, color: '#fff' }}>
        <b>Instructions:</b>
        <ul style={{ fontSize: '0.95em' }}>
          <li>Start voice chat, enter a room ID and your name, then Join.</li>
          <li>Share the room ID with your friend to connect.</li>
          <li>Use Mute/Leave/Stop for controls; Debug logs details to console.</li>
        </ul>
      </div>

      {/* Hidden audio elements for playback */}
      <audio ref={localAudioRef} autoPlay muted />
      <audio ref={remoteAudioRef} autoPlay />
    </div>
  )
}

const tabs = [...document.querySelectorAll('.tab')];
const tabContents = [...document.querySelectorAll('.tab-content')];
const roomPanel = document.getElementById('room-panel');
const roomCodeLabel = document.getElementById('room-code-label');
const statusText = document.getElementById('status-text');
const memberCount = document.getElementById('member-count');
const video = document.getElementById('video');
const createForm = document.getElementById('create-form');
const joinForm = document.getElementById('join-form');
const copyRoomLinkButton = document.getElementById('copy-room-link');

const state = {
  socket: null,
  roomCode: '',
  sourceUrl: '',
  hls: null,
  isHost: false,
  lastSyncSentAt: 0,
  lastSyncStatus: '',
  lastSyncTime: 0,
  lastRemoteSync: null,
  lastLocalActionAt: 0,
  webrtc: {
    peers: new Map(),
    channels: new Map(),
  },
};

function switchTab(tabName) {
  tabs.forEach((tab) => {
    const isActive = tab.dataset.tab === tabName;
    tab.classList.toggle('active', isActive);
  });

  tabContents.forEach((panel) => {
    const isActive = panel.id === `${tabName}-panel`;
    panel.classList.toggle('active', isActive);
  });
}

function updateStatus(text) {
  statusText.textContent = text;
}

function updateMembers(count) {
  memberCount.textContent = `${count} ${count === 1 ? 'person' : 'people'}`;
}

function getVideoSyncState() {
  const nextStatus = video.paused ? 'paused' : 'playing';
  const nextTime = Number(video.currentTime) || 0;
  return { status: nextStatus, currentTime: nextTime };
}

function applyRemoteState(payload) {
  const roomState = payload?.state || payload || {};
  const remoteStatus = roomState.status || 'paused';
  const remoteTime = Number(roomState.currentTime) || 0;
  const updatedAt = Number(roomState.updatedAt) || Date.now();
  const elapsed = (Date.now() - updatedAt) / 1000;
  const adjusted = remoteStatus === 'playing' ? remoteTime + elapsed : remoteTime;
  const signature = `${remoteStatus}:${Math.round(adjusted * 10)}`;

  if (state.lastRemoteSync && state.lastRemoteSync.signature === signature && Date.now() - state.lastRemoteSync.time < 800) {
    return;
  }

  state.lastRemoteSync = { signature, time: Date.now() };
  state.isHost = Boolean(payload?.isHost ?? false);

  if (roomState.status) {
    updateStatus(roomState.status === 'playing' ? 'Playing' : 'Paused');
  }

  if (!video.src) {
    return;
  }

  const localStatus = video.paused ? 'paused' : 'playing';

  if (remoteStatus === 'playing' && localStatus !== 'playing') {
    if (Math.abs(video.currentTime - adjusted) > 0.8) {
      video.currentTime = adjusted;
    }
    video.play().catch(() => {});
    return;
  }

  if (remoteStatus === 'paused') {
    if (Math.abs(video.currentTime - adjusted) > 0.8) {
      video.currentTime = adjusted;
    }
    if (!video.paused) {
      video.pause();
    }
    return;
  }

  if (Math.abs(video.currentTime - adjusted) > 1.2) {
    video.currentTime = adjusted;
  }
}

function bindWebRtcChannel(remoteId, channel) {
  channel.onopen = () => {
    sendWebRtcState(true);
  };

  channel.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      if (!message || message.type !== 'sync' || message.roomCode !== state.roomCode) {
        return;
      }
      applyRemoteState({ state: message.state, isHost: false });
    } catch (error) {
      console.warn('WebRTC sync message ignored.', error);
    }
  };
}

function createPeerConnection(remoteId, shouldCreateOffer = true) {
  if (!window.RTCPeerConnection || !state.socket || !state.roomCode || remoteId === state.socket.id) {
    return;
  }

  if (state.webrtc.peers.has(remoteId)) {
    return;
  }

  const peerConnection = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  });

  state.webrtc.peers.set(remoteId, peerConnection);

  const dataChannel = peerConnection.createDataChannel('sync-channel', { ordered: true });
  state.webrtc.channels.set(remoteId, dataChannel);
  bindWebRtcChannel(remoteId, dataChannel);

  peerConnection.ondatachannel = (event) => {
    const channel = event.channel;
    state.webrtc.channels.set(remoteId, channel);
    bindWebRtcChannel(remoteId, channel);
  };

  peerConnection.onicecandidate = (event) => {
    if (!event.candidate || !state.socket) {
      return;
    }
    state.socket.emit('webrtc:signal', {
      roomCode: state.roomCode,
      targetId: remoteId,
      signal: { type: 'candidate', candidate: event.candidate },
    });
  };

  if (shouldCreateOffer) {
    peerConnection.createOffer()
      .then((offer) => peerConnection.setLocalDescription(offer))
      .then(() => {
        state.socket.emit('webrtc:signal', {
          roomCode: state.roomCode,
          targetId: remoteId,
          signal: peerConnection.localDescription,
        });
      })
      .catch(() => {});
  }
}

function handleRemoteSignal({ sourceId, signal }) {
  if (!sourceId || !signal || !state.socket || !state.roomCode) {
    return;
  }

  if (!state.webrtc.peers.has(sourceId)) {
    createPeerConnection(sourceId, false);
  }

  const peerConnection = state.webrtc.peers.get(sourceId);

  if (!peerConnection) {
    return;
  }

  if (signal.type === 'candidate') {
    peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate)).catch(() => {});
    return;
  }

  if (signal.type === 'offer') {
    peerConnection.setRemoteDescription(new RTCSessionDescription(signal))
      .then(() => peerConnection.createAnswer())
      .then((answer) => peerConnection.setLocalDescription(answer))
      .then(() => {
        state.socket.emit('webrtc:signal', {
          roomCode: state.roomCode,
          targetId: sourceId,
          signal: peerConnection.localDescription,
        });
      })
      .catch(() => {});
    return;
  }

  if (signal.type === 'answer') {
    peerConnection.setRemoteDescription(new RTCSessionDescription(signal)).catch(() => {});
  }
}

function syncMemberPeers(memberIds = []) {
  if (!Array.isArray(memberIds)) {
    return;
  }

  memberIds
    .filter((memberId) => typeof memberId === 'string' && memberId && memberId !== state.socket?.id)
    .forEach((memberId) => createPeerConnection(memberId));
}

function sendWebRtcState(force = false) {
  if (!state.socket || !state.roomCode || state.webrtc.channels.size === 0) {
    return;
  }

  const snapshot = getVideoSyncState();
  const now = Date.now();

  if (!force && now - state.lastLocalActionAt < 250 && state.lastSyncStatus === snapshot.status && Math.abs(state.lastSyncTime - snapshot.currentTime) < 0.35) {
    return;
  }

  state.lastLocalActionAt = now;
  state.lastSyncSentAt = now;
  state.lastSyncStatus = snapshot.status;
  state.lastSyncTime = snapshot.currentTime;

  const payload = {
    type: 'sync',
    roomCode: state.roomCode,
    state: {
      status: snapshot.status,
      currentTime: snapshot.currentTime,
      updatedAt: Date.now(),
    },
  };

  state.webrtc.channels.forEach((channel) => {
    if (channel && channel.readyState === 'open') {
      channel.send(JSON.stringify(payload));
    }
  });
}

function initSocket() {
  if (state.socket) {
    return;
  }

  state.socket = io();

  state.socket.on('connect', () => {
    if (state.roomCode) {
      state.socket.emit('join-room', { roomCode: state.roomCode });
    }
  });

  state.socket.on('room:joined', (payload) => {
    if (!payload || payload.code !== state.roomCode) {
      return;
    }

    state.isHost = Boolean(payload.isHost ?? false);
    updateMembers(payload.members || payload.memberIds?.length || 0);
    roomCodeLabel.textContent = payload.code;
    syncMemberPeers(payload.memberIds || []);
  });

  state.socket.on('room:state', (payload) => {
    if (!payload || !payload.code || payload.code !== state.roomCode) {
      return;
    }

    if (Array.isArray(payload.memberIds)) {
      syncMemberPeers(payload.memberIds);
    }

    if (payload.state) {
      applyRemoteState(payload);
    }
  });

  state.socket.on('webrtc:signal', ({ sourceId, signal, roomCode }) => {
    if (!roomCode || roomCode !== state.roomCode) {
      return;
    }
    handleRemoteSignal({ sourceId, signal });
  });

  state.socket.on('room:error', ({ message }) => {
    updateStatus(message);
    alert(message);
  });
}

function stopHls() {
  if (state.hls) {
    state.hls.destroy();
    state.hls = null;
  }

  video.removeAttribute('src');
  video.load();
}

function toProxyUrl(url) {
  return `/proxy/manifest?url=${encodeURIComponent(url)}`;
}

function loadSource(url) {
  stopHls();
  const proxiedUrl = toProxyUrl(url);

  if (Hls.isSupported()) {
    const hls = new Hls({
      lowLatencyMode: false,
      backBufferLength: 90,
    });

    state.hls = hls;
    hls.loadSource(proxiedUrl);
    hls.attachMedia(video);
    hls.on(Hls.Events.ERROR, (_, data) => {
      if (data.fatal) {
        updateStatus('Unable to load this .m3u8 video.');
      }
    });
    return;
  }

  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = proxiedUrl;
    return;
  }

  updateStatus('This browser does not support HLS streams.');
}

function sendRoomState(force = false) {
  if (!state.socket || !state.roomCode || !state.isHost) {
    return;
  }

  const snapshot = getVideoSyncState();
  const now = Date.now();

  if (now - state.lastLocalActionAt < 250 && !force) {
    return;
  }

  state.lastLocalActionAt = now;

  if (!force && now - state.lastSyncSentAt < 250 && state.lastSyncStatus === snapshot.status && Math.abs(state.lastSyncTime - snapshot.currentTime) < 0.35) {
    return;
  }

  state.lastSyncSentAt = now;
  state.lastSyncStatus = snapshot.status;
  state.lastSyncTime = snapshot.currentTime;

  state.socket.emit('room:state:update', {
    roomCode: state.roomCode,
    status: snapshot.status,
    currentTime: snapshot.currentTime,
  });

  sendWebRtcState(true);
}

async function createRoom(sourceUrl) {
  updateStatus('Creating room...');

  const response = await fetch('/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceUrl }),
  });

  const data = await response.json();

  if (!response.ok) {
    updateStatus(data.error || 'Could not create room.');
    return;
  }

  const { room } = data;
  state.sourceUrl = room.sourceUrl;
  state.roomCode = room.code;
  state.isHost = true;
  roomPanel.classList.remove('hidden');
  roomCodeLabel.textContent = room.code;
  loadSource(room.sourceUrl);
  initSocket();
  state.socket.emit('join-room', { roomCode: room.code });
  updateMembers(room.members || 0);
  updateStatus('Room ready');
}

async function joinByCode(roomCode) {
  const response = await fetch('/api/rooms/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomCode }),
  });

  const data = await response.json();

  if (!response.ok) {
    updateStatus(data.error || 'Room not found.');
    return;
  }

  const { room } = data;
  state.sourceUrl = room.sourceUrl;
  state.roomCode = room.code;
  state.isHost = false;
  roomPanel.classList.remove('hidden');
  roomCodeLabel.textContent = room.code;
  loadSource(room.sourceUrl);
  initSocket();
  state.socket.emit('join-room', { roomCode: room.code });
  updateMembers(room.members || 0);
  updateStatus('Joined room');
}

tabs.forEach((tab) => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

createForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(createForm);
  const sourceUrl = String(formData.get('sourceUrl') || '').trim();

  if (!sourceUrl) {
    updateStatus('Add a .m3u8 URL.');
    return;
  }

  await createRoom(sourceUrl);
});

joinForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const roomCode = document.getElementById('room-code').value.trim();

  if (!roomCode) {
    updateStatus('Add the room code.');
    return;
  }

  await joinByCode(roomCode);
});

copyRoomLinkButton.addEventListener('click', async () => {
  const roomLink = `${window.location.origin}?room=${state.roomCode}`;
  await navigator.clipboard.writeText(roomLink);
  updateStatus('Room link copied');
});

video.addEventListener('play', () => {
  sendRoomState(true);
});

video.addEventListener('pause', () => {
  sendRoomState(true);
});

video.addEventListener('seeked', () => {
  sendRoomState(true);
});

video.addEventListener('timeupdate', () => {
  if (!video.paused && Math.abs((Number(video.currentTime) || 0) - state.lastSyncTime) > 1.2) {
    sendRoomState();
  }
});

window.addEventListener('load', () => {
  const params = new URLSearchParams(window.location.search);
  const roomCode = params.get('room');

  if (roomCode) {
    switchTab('join');
    document.getElementById('room-code').value = roomCode;
    joinByCode(roomCode);
  }
});

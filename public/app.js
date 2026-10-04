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

  state.socket.on('room:state', (payload) => {
    if (!payload || !payload.code || payload.code !== state.roomCode) {
      return;
    }

    const remoteStatus = payload.state?.status || 'paused';
    const remoteTime = Number(payload.state?.currentTime) || 0;
    const updatedAt = Number(payload.state?.updatedAt) || Date.now();
    const elapsed = (Date.now() - updatedAt) / 1000;
    const adjusted = remoteStatus === 'playing' ? remoteTime + elapsed : remoteTime;
    const signature = `${remoteStatus}:${Math.round(adjusted * 10)}`;

    if (state.lastRemoteSync && state.lastRemoteSync.signature === signature && Date.now() - state.lastRemoteSync.time < 800) {
      return;
    }

    state.lastRemoteSync = { signature, time: Date.now() };
    state.isHost = Boolean(payload.isHost ?? false);

    updateMembers(payload.members || 0);
    roomCodeLabel.textContent = payload.code;

    if (payload.state && payload.state.status) {
      updateStatus(payload.state.status === 'playing' ? 'Playing' : 'Paused');
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

  const nextStatus = video.paused ? 'paused' : 'playing';
  const nextTime = Number(video.currentTime) || 0;
  const now = Date.now();

  if (now - state.lastLocalActionAt < 250 && !force) {
    return;
  }

  state.lastLocalActionAt = now;

  if (!force && now - state.lastSyncSentAt < 250 && state.lastSyncStatus === nextStatus && Math.abs(state.lastSyncTime - nextTime) < 0.35) {
    return;
  }

  state.lastSyncSentAt = now;
  state.lastSyncStatus = nextStatus;
  state.lastSyncTime = nextTime;

  state.socket.emit('room:state:update', {
    roomCode: state.roomCode,
    status: nextStatus,
    currentTime: nextTime,
  });
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

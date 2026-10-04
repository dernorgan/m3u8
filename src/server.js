const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const { rooms, normalizeSourceUrl, makeRoomCode, getRoomPayload } = require('./roomStore');
const { registerHlsProxy } = require('./hlsProxy');
const { registerSocket } = require('./socket');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', (_, res) => {
  res.json({ ok: true, rooms: Object.keys(rooms).length });
});

app.post('/api/rooms', (req, res) => {
  const sourceUrl = normalizeSourceUrl(req.body?.sourceUrl || '');

  if (!sourceUrl || !sourceUrl.toLowerCase().includes('.m3u8')) {
    return res.status(400).json({ error: 'Please enter a valid .m3u8 URL.' });
  }

  let code = makeRoomCode();

  while (rooms[code]) {
    code = makeRoomCode();
  }

  rooms[code] = {
    code,
    sourceUrl,
    members: new Set(),
    state: {
      status: 'paused',
      currentTime: 0,
      updatedAt: Date.now(),
    },
  };

  return res.status(201).json({ room: getRoomPayload(code) });
});

app.post('/api/rooms/join', (req, res) => {
  const roomCode = (req.body?.roomCode || '').trim().toUpperCase();
  const room = rooms[roomCode];

  if (!room) {
    return res.status(404).json({ error: 'Room not found.' });
  }

  return res.json({ room: getRoomPayload(roomCode) });
});

registerHlsProxy(app);
registerSocket(io);

app.get('*', (_, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

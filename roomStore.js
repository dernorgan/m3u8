const rooms = {};

function makeRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let value = '';

  for (let i = 0; i < 6; i += 1) {
    value += chars[Math.floor(Math.random() * chars.length)];
  }

  return value;
}

function normalizeSourceUrl(rawUrl) {
  if (typeof rawUrl !== 'string') {
    return '';
  }

  const url = rawUrl.trim();

  if (!url) {
    return '';
  }

  if (!/^https?:\/\//i.test(url)) {
    return '';
  }

  return url;
}

function getRoomPayload(roomCode) {
  const room = rooms[roomCode];

  if (!room) {
    return null;
  }

  return {
    code: room.code,
    sourceUrl: room.sourceUrl,
    state: {
      status: room.state.status,
      currentTime: room.state.currentTime,
      updatedAt: room.state.updatedAt,
    },
    members: room.members.size,
  };
}

function emitRoomState(io, roomCode) {
  const room = rooms[roomCode];

  if (!room) {
    return;
  }

  io.to(roomCode).emit('room:state', getRoomPayload(roomCode));
}

module.exports = {
  rooms,
  makeRoomCode,
  normalizeSourceUrl,
  getRoomPayload,
  emitRoomState,
};

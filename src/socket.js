const { rooms, getRoomPayload } = require('./roomStore');

function registerSocket(io) {
  io.on('connection', (socket) => {
    socket.on('join-room', ({ roomCode }) => {
      const targetCode = String(roomCode || '').trim().toUpperCase();
      const room = rooms[targetCode];

      if (!room) {
        socket.emit('room:error', { message: 'Room not found.' });
        return;
      }

      if (socket.data.roomCode && rooms[socket.data.roomCode]) {
        const previousRoom = rooms[socket.data.roomCode];
        previousRoom.members.delete(socket.id);
        socket.leave(socket.data.roomCode);
      }

      socket.data.roomCode = targetCode;
      room.members.add(socket.id);

      if (!room.hostId || !room.members.has(room.hostId)) {
        room.hostId = socket.id;
      }

      socket.join(targetCode);

      const selfPayload = { ...getRoomPayload(targetCode), isHost: socket.id === room.hostId };
      const othersPayload = { ...getRoomPayload(targetCode), isHost: false };

      socket.emit('room:joined', selfPayload);
      socket.emit('room:state', selfPayload);
      socket.to(targetCode).emit('room:state', othersPayload);
    });

    socket.on('room:state:update', ({ roomCode, status, currentTime }) => {
      const targetCode = String(roomCode || '').trim().toUpperCase();
      const room = rooms[targetCode];

      if (!room || room.hostId !== socket.id) {
        return;
      }

      const safeStatus = status === 'playing' ? 'playing' : 'paused';
      const safeTime = Number.isFinite(Number(currentTime)) ? Number(currentTime) : room.state.currentTime;
      const now = Date.now();

      room.state = {
        status: safeStatus,
        currentTime: Math.max(0, safeTime),
        updatedAt: now,
      };

      const payload = { ...getRoomPayload(targetCode), isHost: false };
      io.to(targetCode).emit('room:state', payload);
    });

    socket.on('disconnect', () => {
      const roomCode = socket.data.roomCode;

      if (!roomCode || !rooms[roomCode]) {
        return;
      }

      const room = rooms[roomCode];
      room.members.delete(socket.id);
      socket.leave(roomCode);

      if (room.hostId === socket.id) {
        room.hostId = Array.from(room.members)[0] || null;
      }

      if (room.members.size === 0) {
        delete rooms[roomCode];
      } else {
        const payload = { ...getRoomPayload(roomCode), isHost: false };
        io.to(roomCode).emit('room:state', payload);
      }
    });
  });
}

module.exports = {
  registerSocket,
};

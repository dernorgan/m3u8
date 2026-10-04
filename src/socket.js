const { rooms, getRoomPayload, emitRoomState } = require('./roomStore');

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
      socket.join(targetCode);
      socket.emit('room:joined', getRoomPayload(targetCode));
      socket.emit('room:state', getRoomPayload(targetCode));
      io.to(targetCode).emit('room:state', getRoomPayload(targetCode));
    });

    socket.on('room:state:update', ({ roomCode, status, currentTime }) => {
      const targetCode = String(roomCode || '').trim().toUpperCase();
      const room = rooms[targetCode];

      if (!room) {
        return;
      }

      const safeStatus = status === 'playing' ? 'playing' : 'paused';
      const safeTime = Number.isFinite(Number(currentTime)) ? Number(currentTime) : room.state.currentTime;

      room.state = {
        status: safeStatus,
        currentTime: Math.max(0, safeTime),
        updatedAt: Date.now(),
      };

      const payload = getRoomPayload(targetCode);
      socket.to(targetCode).emit('room:state', payload);
    });

    socket.on('disconnect', () => {
      const roomCode = socket.data.roomCode;

      if (!roomCode || !rooms[roomCode]) {
        return;
      }

      const room = rooms[roomCode];
      room.members.delete(socket.id);
      socket.leave(roomCode);

      if (room.members.size === 0) {
        delete rooms[roomCode];
      }
    });
  });
}

module.exports = {
  registerSocket,
};

# SyncStream

Watch synchronized video together with a shared `.m3u8` link.

## Features

- Create a room with a `.m3u8` URL
- Join a room by code
- Watch the same video stream in the same room
- Play/pause/seek sync across connected clients
- No database, no accounts, no chat, no profiles

## Run locally

```bash
npm install
npm start
```

Then open:

- http://localhost:3000

## Notes

- Rooms are stored in memory only.
- Restarting the server clears all rooms.
- This is intended as a lightweight room-based streaming experience.

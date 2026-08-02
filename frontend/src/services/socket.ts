import { io } from 'socket.io-client';

// Connect to the socket.io server on the same origin.
// Vite dev proxy routes /socket.io to localhost:3001 locally;
// in production nginx proxies /socket.io to the backend.
export const socket = io({
  autoConnect: true,
  reconnection: true
});

socket.on('connect', () => {
  console.log('[Socket] Connected:', socket.id);
});

socket.on('disconnect', () => {
  console.log('[Socket] Disconnected');
});

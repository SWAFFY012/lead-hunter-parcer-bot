import { io } from 'socket.io-client';

// Connect to the socket.io server.
// With Vite proxy configured for /socket.io, this will automatically route to localhost:3001
export const socket = io(`http://${window.location.hostname}:3001`, {
  autoConnect: true,
  reconnection: true
});

socket.on('connect', () => {
  console.log('[Socket] Connected:', socket.id);
});

socket.on('disconnect', () => {
  console.log('[Socket] Disconnected');
});

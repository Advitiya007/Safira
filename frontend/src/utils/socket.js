import { io } from 'socket.io-client';

const configuredUrl = import.meta.env.VITE_SOCKET_URL || import.meta.env.VITE_API_URL || 'http://localhost:5000';
const socketUrl = configuredUrl.replace(/\/api\/?$/, '').replace(/\/+$/, '');

let socket;

export const getSocket = () => {
  if (!socket) {
    socket = io(socketUrl, {
      autoConnect: false,
      auth: (callback) => callback({ token: localStorage.getItem('authToken') }),
    });
  }
  return socket;
};

export const connectSocket = () => {
  if (!localStorage.getItem('authToken')) return null;

  const sharedSocket = getSocket();
  if (!sharedSocket.connected) sharedSocket.connect();
  return sharedSocket;
};

export const disconnectSocket = () => {
  if (socket) socket.disconnect();
};

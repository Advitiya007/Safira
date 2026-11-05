import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import Guardian from './models/Guardian.js';
import User from './models/User.js';
import { decryptContact, hashContact } from './services/contactEncryptionService.js';

const trackingRoom = (userId) => `tracking:${userId}`;
const trackingSessions = new Map();

const acknowledge = (callback, response) => {
  if (typeof callback === 'function') callback(response);
};

const isValidCoordinate = (value) => (
  typeof value === 'number' && Number.isFinite(value)
);

export const initializeSocketServer = (httpServer, allowedOrigins) => {
  const io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      },
      credentials: true,
    },
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Authentication required'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.userId).select('phone isActive');
      if (!user || !user.isActive) return next(new Error('Invalid authentication'));

      socket.data.userId = user._id.toString();
      socket.data.phoneHash = hashContact(decryptContact(user.phone));
      next();
    } catch {
      next(new Error('Invalid authentication'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId;

    socket.on('tracking:start', (callback) => {
      let session = trackingSessions.get(userId);
      if (!session) {
        session = { socketIds: new Set(), location: null };
        trackingSessions.set(userId, session);
      }

      session.socketIds.add(socket.id);
      socket.join(trackingRoom(userId));
      acknowledge(callback, { success: true });
    });

    socket.on('tracking:location', (location, callback) => {
      const session = trackingSessions.get(userId);
      const latitude = location?.latitude;
      const longitude = location?.longitude;

      if (!session?.socketIds.has(socket.id)) {
        return acknowledge(callback, { success: false, message: 'Tracking is not active' });
      }
      if (
        !isValidCoordinate(latitude) || latitude < -90 || latitude > 90 ||
        !isValidCoordinate(longitude) || longitude < -180 || longitude > 180
      ) {
        return acknowledge(callback, { success: false, message: 'Invalid coordinates' });
      }

      session.location = {
        userId,
        latitude,
        longitude,
        accuracy: isValidCoordinate(location.accuracy) ? location.accuracy : null,
        timestamp: Date.now(),
      };
      io.to(trackingRoom(userId)).emit('tracking:location', session.location);
      acknowledge(callback, { success: true });
    });

    socket.on('tracking:subscribe', async ({ ownerId } = {}, callback) => {
      try {
        if (!mongoose.Types.ObjectId.isValid(ownerId) || ownerId === userId) {
          return acknowledge(callback, { success: false, message: 'Invalid tracking owner' });
        }
        const session = trackingSessions.get(ownerId);
        if (!session) {
          return acknowledge(callback, { success: false, message: 'Tracking is not active' });
        }

        const guardian = await Guardian.findOne({
          userId: ownerId,
          guardianPhoneHash: socket.data.phoneHash,
          status: 'active',
          isVerified: true,
        }).select('_id').lean();
        if (!guardian) {
          return acknowledge(callback, { success: false, message: 'Not an authorized trusted contact' });
        }

        await socket.join(trackingRoom(ownerId));
        acknowledge(callback, { success: true });
        if (session.location) socket.emit('tracking:location', session.location);
      } catch (error) {
        console.error('Tracking subscription failed:', error);
        acknowledge(callback, { success: false, message: 'Unable to subscribe to tracking' });
      }
    });

    socket.on('tracking:unsubscribe', ({ ownerId } = {}) => {
      if (mongoose.Types.ObjectId.isValid(ownerId)) {
        socket.leave(trackingRoom(ownerId));
      }
    });

    const stopTracking = () => {
      const session = trackingSessions.get(userId);
      if (!session?.socketIds.delete(socket.id)) return;
      if (session.socketIds.size > 0) return;

      trackingSessions.delete(userId);
      io.to(trackingRoom(userId)).emit('tracking:stopped', { userId });
      io.in(trackingRoom(userId)).socketsLeave(trackingRoom(userId));
    };

    socket.on('tracking:stop', (callback) => {
      stopTracking();
      acknowledge(callback, { success: true });
    });

    socket.on('disconnect', stopTracking);
  });

  return io;
};

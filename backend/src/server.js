import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import { createServer } from 'node:http';
import { errorHandler } from './middleware/errorHandler.js';
import { initializeSocketServer } from './socket.js';

// Route imports
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import locationRoutes from './routes/locationRoutes.js';
import guardianRoutes from './routes/guardianRoutes.js';
import sosRoutes from './routes/sosRoutes.js';
import activityRoutes from './routes/activityRoutes.js';
import safeRouteRoutes from './routes/safeRouteRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import { validateContactEncryptionKey } from './services/contactEncryptionService.js';
import { migrateStoredContactNumbers } from './services/contactMigrationService.js';

validateContactEncryptionKey();
const app = express();
const httpServer = createServer(app);

// IMMEDIATELY DEFINE ROOT ROUTE FOR TESTING
app.get('/', (req, res) => {
  res.send('Safira Backend API is working!');
});

// Verification Route
app.get('/verify', (req, res) => {
  res.json({ success: true, message: 'Antigravity verified' });
});


// Middleware
app.use(express.json());
// CORS Configuration
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:5173'
].filter(Boolean);
// const allowedOrigins = [
//   process.env.FRONTEND_URL,
//   'https://safeher-india.netlify.app', // Adding explicit fallback for production
//   'http://localhost:5173'
// ].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV !== 'production') {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/guardians', guardianRoutes);
app.use('/api/sos', sosRoutes);
app.use('/api/activities', activityRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api', safeRouteRoutes);

// Health Check
app.get('/api/health', (req, res) => {
  res.status(200).json({ success: true, message: 'Server is healthy' });
});

// Error handling payload
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI must be configured');
  await mongoose.connect(process.env.MONGO_URI);
  const migration = await migrateStoredContactNumbers();
  if (migration.usersUpdated || migration.guardiansUpdated) {
    console.log(
      `Encrypted contact numbers for ${migration.usersUpdated} user record(s) and ${migration.guardiansUpdated} guardian record(s).`,
    );
  }

  initializeSocketServer(httpServer, allowedOrigins);
  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(PORT, () => {
      httpServer.off('error', reject);
      resolve();
    });
  });
  console.log(`MongoDB connected successfully; Safira server running on port ${PORT}`);
};

startServer().catch((error) => {
  console.error(`Server startup failed: ${error.message}`);
  if (mongoose.connection.readyState) {
    mongoose.disconnect().catch((disconnectError) => {
      console.error(`MongoDB disconnect failed: ${disconnectError.message}`);
    });
  }
  process.exitCode = 1;
});

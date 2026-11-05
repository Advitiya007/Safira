import express from 'express';
import { registerUser, loginUser, logoutUser, getCurrentUser, refreshToken } from '../controllers/authController.js';
import { verifyToken } from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/logout', verifyToken, logoutUser);
router.get('/me', verifyToken, getCurrentUser);
router.get('/refresh', verifyToken, refreshToken);

export default router;

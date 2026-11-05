import express from 'express';
import { getCurrentAffairs } from '../controllers/dashboardController.js';
import { verifyToken } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(verifyToken);
router.get('/current-affairs', getCurrentAffairs);

export default router;

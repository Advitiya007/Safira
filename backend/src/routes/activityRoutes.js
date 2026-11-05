import express from 'express';
import { getActivityLog } from '../controllers/activityController.js';
import { verifyToken } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(verifyToken);
router.get('/', getActivityLog);

export default router;

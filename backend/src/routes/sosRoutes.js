import express from 'express';
import { triggerSOS, getSOSHistory, resolveSOS, getSOS } from '../controllers/sosController.js';
import { verifyToken } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(verifyToken);

router.post('/trigger', triggerSOS);
router.get('/history', getSOSHistory);
router.route('/:id')
    .get(getSOS)
    .put(resolveSOS);
router.put('/:id/resolve', resolveSOS);

export default router;

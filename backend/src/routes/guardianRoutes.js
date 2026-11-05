import express from 'express';
import { addGuardian, getGuardians, removeGuardian, updateGuardian } from '../controllers/guardianController.js';
import { verifyToken } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(verifyToken);

router.route('/')
    .post(addGuardian)
    .get(getGuardians);

router.route('/:id')
    .delete(removeGuardian)
    .put(updateGuardian);

export default router;

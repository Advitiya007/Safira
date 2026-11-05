import express from 'express';
import { getNearbyPlaces, searchPlaces, getPlaceDetails, getRouteSafety } from '../controllers/locationController.js';

const router = express.Router();

router.get('/nearby', getNearbyPlaces);
router.get('/search', searchPlaces);
router.post('/route-safety', getRouteSafety);
router.get('/:id', getPlaceDetails);

export default router;

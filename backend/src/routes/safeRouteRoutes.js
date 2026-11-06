import express from 'express';
import { verifyToken } from '../middleware/authMiddleware.js';
import {
    analyzeRoutes,
    getCityCoverageDetails,
    getNearbyPlaces,
    getRouteAnalysis,
    getRouteAnalysisDetails,
    geocode,
    listCities,
    locateCity,
} from '../controllers/safeRouteController.js';

const router = express.Router();

router.get('/cities', listCities);
router.get('/geocode', geocode);
router.get('/cities/locate', locateCity);
router.get('/cities/:cityId/coverage', getCityCoverageDetails);
router.get('/places/nearby', getNearbyPlaces);
router.post('/safe-routes/analyze', verifyToken, (req, res, next) => {
    const controller = new AbortController();
    req.routeAbortController = controller;
    req.on('aborted', () => controller.abort());
    next();
}, analyzeRoutes);
router.get('/safe-routes/:id/details', verifyToken, getRouteAnalysisDetails);
router.get('/safe-routes/:id', verifyToken, getRouteAnalysis);

export default router;

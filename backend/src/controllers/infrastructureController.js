import { getModelSummary, getRouteInfrastructure } from '../services/infrastructureService.js';

const sendError = (res, error) => res.status(error.statusCode || 500).json({
    success: false,
    message: error.message || 'Infrastructure profile request failed',
});

// Always 200 when the analysis is the caller's own: an unavailable ML service is reported in the
// payload (`available: false`) so the Safe Route page keeps working without it.
export const getRouteInfrastructureProfile = async (req, res) => {
    try {
        const data = await getRouteInfrastructure(req.params.id, req.user.userId);
        return res.status(200).json({ success: true, data });
    } catch (error) {
        return sendError(res, error);
    }
};

export const getInfrastructureModel = async (req, res) => {
    try {
        const data = await getModelSummary();
        return res.status(200).json({ success: true, data });
    } catch (error) {
        return sendError(res, error);
    }
};

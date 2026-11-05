import { getPositiveCurrentAffairs } from '../services/positiveNewsService.js';

const getCurrentAffairs = async (req, res, next) => {
    try {
        const data = await getPositiveCurrentAffairs({
            forceRefresh: req.query.refresh === 'true',
        });
        res.status(200).json({
            success: true,
            message: 'Positive current affairs retrieved',
            data,
        });
    } catch (error) {
        next(error);
    }
};

export { getCurrentAffairs };

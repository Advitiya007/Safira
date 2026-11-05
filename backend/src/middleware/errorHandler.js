const errorHandler = (err, req, res, next) => {
    console.error(err.stack);
    const statusCode = err.statusCode || (res.statusCode === 200 ? 500 : res.statusCode);
    res.status(statusCode).json({
        success: false,
        message: err.message || 'Server Error',
        statusCode: statusCode
    });
};

export { errorHandler };

// In src/utils/ApiError.js
class ApiError extends Error {
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
        this.name = 'ApiError'; // Optional: helps identify the error type
    }
}

module.exports = ApiError;
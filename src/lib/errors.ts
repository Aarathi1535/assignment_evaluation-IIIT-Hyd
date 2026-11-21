export class HttpError extends Error {
    statusCode: number;

    constructor(message: string, statusCode: number) {
        super(message);
        this.statusCode = statusCode;
        this.name = 'HttpError';
        
        // Ensure prototype is set correctly for custom ES5/ES6 error class
        Object.setPrototypeOf(this, HttpError.prototype);
    }
}

/**
 * Checks if the given error is a MongoDB duplicate key error (code 11000)
 * or a string matching duplicate key error patterns.
 */
export function isDuplicateKeyError(error: unknown): boolean {
    if (!error) return false;
    if (typeof error === 'object') {
        if ('code' in error && (error as { code: unknown }).code === 11000) {
            return true;
        }
        if ('message' in error && typeof (error as { message: unknown }).message === 'string') {
            const msg = (error as { message: string }).message;
            return msg.includes('E11000') || msg.includes('duplicate key') || msg.includes('dup key');
        }
    }
    if (typeof error === 'string') {
        return error.includes('E11000') || error.includes('duplicate key') || error.includes('dup key');
    }
    return false;
}

/**
 * Checks if the given error is a database concurrency or transaction conflict,
 * including MongoDB duplicate key errors (code 11000), write conflicts (code 112 / WriteConflict),
 * Mongoose VersionErrors, or transient transaction conflicts.
 */
export function isConflictError(error: unknown): boolean {
    if (!error) return false;
    if (isDuplicateKeyError(error)) return true;

    if (typeof error === 'object') {
        const errObj = error as Record<string, unknown>;
        if (errObj.code === 112 || errObj.codeName === 'WriteConflict') {
            return true;
        }
        if (errObj.name === 'VersionError') {
            return true;
        }
        if (Array.isArray(errObj.errorLabels) && errObj.errorLabels.includes('TransientTransactionError')) {
            return true;
        }
        if (typeof errObj.message === 'string') {
            const msg = errObj.message;
            if (
                msg.includes('WriteConflict') ||
                msg.includes('duplicate key') ||
                msg.includes('dup key') ||
                msg.includes('E11000') ||
                msg.includes('TransientTransactionError') ||
                msg.includes('transaction was aborted') ||
                msg.includes('could not serialize access')
            ) {
                return true;
            }
        }
    }
    if (typeof error === 'string') {
        return (
            error.includes('WriteConflict') ||
            error.includes('duplicate key') ||
            error.includes('dup key') ||
            error.includes('E11000') ||
            error.includes('TransientTransactionError') ||
            error.includes('transaction was aborted')
        );
    }
    return false;
}

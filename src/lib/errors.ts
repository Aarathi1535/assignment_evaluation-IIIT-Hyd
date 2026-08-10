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

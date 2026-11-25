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
 * Checks if the given error is a concurrency conflict:
 * narrowed strictly to the Grade unique-index E11000 ({ answerScript, question })
 * and MongoDB WriteConflict (code 112 / WriteConflict) cases only.
 */
export function isConflictError(error: unknown): boolean {
    if (!error) return false;

    if (typeof error === 'object') {
        const errObj = error as Record<string, unknown>;

        // 1. WriteConflict case (code 112 or codeName WriteConflict)
        if (errObj.code === 112 || errObj.codeName === 'WriteConflict') {
            return true;
        }

        // 2. Grade unique-index E11000 duplicate key case
        if (errObj.code === 11000) {
            const keyPattern = errObj.keyPattern as Record<string, unknown> | undefined;
            if (keyPattern && ('answerScript' in keyPattern || 'question' in keyPattern)) {
                return true;
            }
            if (typeof errObj.message === 'string') {
                const msg = errObj.message;
                if (
                    msg.includes('answerScript_1_question_1') ||
                    (msg.includes('answerScript') && msg.includes('question')) ||
                    msg.includes('grades')
                ) {
                    return true;
                }
            }
            return false;
        }

        if (typeof errObj.message === 'string') {
            const msg = errObj.message;
            if (msg.includes('WriteConflict')) {
                return true;
            }
            if (
                (msg.includes('E11000') || msg.includes('duplicate key') || msg.includes('dup key')) &&
                (msg.includes('answerScript_1_question_1') || (msg.includes('answerScript') && msg.includes('question')) || msg.includes('grades'))
            ) {
                return true;
            }
        }
    }

    if (typeof error === 'string') {
        if (error.includes('WriteConflict')) {
            return true;
        }
        if (
            (error.includes('E11000') || error.includes('duplicate key') || error.includes('dup key')) &&
            (error.includes('answerScript_1_question_1') || (error.includes('answerScript') && error.includes('question')) || error.includes('grades'))
        ) {
            return true;
        }
    }

    return false;
}

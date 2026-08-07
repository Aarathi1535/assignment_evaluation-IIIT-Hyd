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

export const env = {
    MONGODB_URI: process.env.MONGODB_URI || '',
    JWT_SECRET: process.env.JWT_SECRET || '',
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET || '',
};

// Validate required environment variables
const requiredEnv = [
    'MONGODB_URI',
    'JWT_SECRET',
    'NEXTAUTH_SECRET',
] as const;

for (const key of requiredEnv) {
    if (!env[key]) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
}
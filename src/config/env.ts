import { z } from 'zod';

const envSchema = z.object({
    MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
    NEXTAUTH_SECRET: z.string().min(1, 'NEXTAUTH_SECRET is required'),
    NEXTAUTH_URL: z.string().min(1, 'NEXTAUTH_URL is required'),
    ORIGINAL_STORAGE_HMAC_SECRET: z.string().min(1, 'ORIGINAL_STORAGE_HMAC_SECRET is required'),
    ORIGINAL_STORAGE_KEY_ID: z.string().default('v1'),
    ORIGINAL_STORAGE_PATH: z.string().optional(),
    FEATURE_CLASSROOM_ASSESSMENT: z.string().optional().default('false'),
    FEATURE_PERSONALIZED_ASSESSMENT: z.string().optional().default('false'),
    NEXT_PUBLIC_FEATURE_CLASSROOM_ASSESSMENT: z.string().optional().default('false'),
    NEXT_PUBLIC_FEATURE_PERSONALIZED_ASSESSMENT: z.string().optional().default('false'),
    VERTEX_AI_MODEL: z.string().optional().default('gemini-3.5-flash'),
    VERTEX_AI_REGION: z.string().optional().default('asia-south1'),
    GOOGLE_CLOUD_PROJECT: z.string().optional().default('assignment-evaluator-iiith'),
    GOOGLE_APPLICATION_CREDENTIALS: z.string().optional()
});

export function validateEnv() {
    const parsed = envSchema.safeParse(process.env);

    if (!parsed.success) {
        console.error('❌ Invalid environment variables:', parsed.error.format());
        throw new Error('Invalid environment variables');
    }

    return parsed.data;
}

export type Env = z.infer<typeof envSchema>;
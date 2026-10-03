import { loadEnvConfig } from '@next/env';
import mongoose from 'mongoose';
import personalizedAssessmentService from '../services/PersonalizedAssessmentService';

async function main(): Promise<void> {
    loadEnvConfig(process.cwd());
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
        throw new Error('MONGODB_URI is not defined in the environment');
    }

    await mongoose.connect(mongoUri);
    try {
        const synchronizedEnrollments = await personalizedAssessmentService.reconcileExistingCourseEnrollments();
        console.log(`Synchronized ${synchronizedEnrollments} existing course enrollment(s) to active personalized schedules.`);
    } finally {
        await mongoose.disconnect();
    }
}

main().catch((error: unknown) => {
    console.error('Personalized schedule enrollment backfill failed:', error);
    process.exitCode = 1;
});

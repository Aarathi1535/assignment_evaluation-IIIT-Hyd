export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        const { validateEnv } = await import('./config/env');
        validateEnv();
        const { connectDB } = await import('./lib/db');
        await connectDB();
        const { initBackgroundWorker } = await import('./lib/workerInit');
        initBackgroundWorker();
    }
}

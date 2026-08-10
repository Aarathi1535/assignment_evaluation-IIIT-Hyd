export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        const { initBackgroundWorker } = await import('./lib/workerInit');
        initBackgroundWorker();
    }
}

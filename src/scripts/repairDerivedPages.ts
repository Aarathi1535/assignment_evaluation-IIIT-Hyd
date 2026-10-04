import { loadEnvConfig } from '@next/env';
import mongoose from 'mongoose';

interface ParsedArguments {
    scriptIds: string[];
    batchIds: string[];
    dryRun: boolean;
}

function parseArguments(args: string[]): ParsedArguments {
    const parsed: ParsedArguments = { scriptIds: [], batchIds: [], dryRun: false };
    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];
        if (argument === '--dry-run') {
            parsed.dryRun = true;
        } else if (argument === '--script' || argument === '--batch') {
            const value = args[index + 1];
            if (!value || value.startsWith('--')) {
                throw new Error(`${argument} requires an ID.`);
            }
            (argument === '--script' ? parsed.scriptIds : parsed.batchIds).push(value);
            index += 1;
        } else {
            throw new Error(`Unknown argument: ${argument}`);
        }
    }
    if (parsed.scriptIds.length === 0 && parsed.batchIds.length === 0) {
        throw new Error('Usage: npm run repair:derived-pages -- [--dry-run] --script <ID> [--batch <ID>]');
    }
    return parsed;
}

async function main(): Promise<void> {
    loadEnvConfig(process.cwd());
    const args = parseArguments(process.argv.slice(2));
    if (!process.env.MONGODB_URI) {
        throw new Error('MONGODB_URI is required.');
    }
    if (!process.env.DERIVED_PAGE_STORAGE_BUCKET?.trim()) {
        throw new Error('DERIVED_PAGE_STORAGE_BUCKET must identify the GCS bucket for this repair.');
    }

    await mongoose.connect(process.env.MONGODB_URI, { bufferCommands: false });
    try {
        const { default: repairService } = await import('../services/DerivedPageRepairService');
        const result = await repairService.repair({
            scriptIds: args.scriptIds,
            batchIds: args.batchIds,
            dryRun: args.dryRun
        });
        console.log(JSON.stringify({ dryRun: args.dryRun, ...result }, null, 2));
        if (result.failed.length > 0) {
            process.exitCode = 1;
        }
    } finally {
        await mongoose.disconnect();
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});

import { loadEnvConfig } from '@next/env';
import mongoose from 'mongoose';

export interface ParsedArguments {
    examId?: string;
    json?: boolean;
    detailed?: boolean;
}

export function parseArguments(args: string[]): ParsedArguments {
    const parsed: ParsedArguments = {};
    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];
        if (argument === '--json') {
            parsed.json = true;
        } else if (argument === '--detailed' || argument === '--all' || argument === '-d') {
            parsed.detailed = true;
        } else if (argument === '--exam' || argument === '--examId' || argument === '--id') {
            const value = args[index + 1];
            if (!value || value.startsWith('--')) {
                throw new Error(`${argument} requires an exam ID.`);
            }
            parsed.examId = value;
            index += 1;
        } else if (!argument.startsWith('--') && !parsed.examId) {
            parsed.examId = argument;
        } else {
            throw new Error(`Unknown argument: ${argument}`);
        }
    }
    if (!parsed.examId) {
        throw new Error('Usage: npm run verify:integrity -- --exam <EXAM_ID> [--json] [--detailed]');
    }
    return parsed;
}

export async function runCli(argsArray: string[]): Promise<number> {
    loadEnvConfig(process.cwd());
    const args = parseArguments(argsArray);

    const shouldDisconnect = mongoose.connection.readyState === 0;
    if (shouldDisconnect) {
        if (!process.env.MONGODB_URI) {
            throw new Error('MONGODB_URI is required.');
        }
        await mongoose.connect(process.env.MONGODB_URI, { bufferCommands: false });
    }

    try {
        const { default: integrityService } = await import('../services/IntegrityVerificationService');
        // By default, bounded memory iteration is used. --detailed requests per-item records.
        const summary = await integrityService.verifyExamIntegrity(
            args.examId!,
            undefined,
            { includeAllItems: args.detailed || args.json }
        );

        if (args.json) {
            console.log(JSON.stringify(summary, null, 2));
        } else {
            console.log('=== Exam Integrity Verification Summary ===');
            console.log(`Exam ID:        ${summary.examId}`);
            console.log(`Timestamp:      ${summary.timestamp}`);
            console.log(`Overall Status: ${summary.status} (Valid: ${summary.valid})`);
            if (summary.reason) {
                console.log(`Reason:         ${summary.reason}`);
            }
            console.log('\n--- Original Files ---');
            console.log(`Total:    ${summary.originalFiles.total}`);
            console.log(`Intact:   ${summary.originalFiles.intact}`);
            console.log(`Mismatch: ${summary.originalFiles.mismatch}`);
            console.log(`Unsealed: ${summary.originalFiles.unsealed}`);
            console.log(`Error:    ${summary.originalFiles.error}`);

            console.log('\n--- Derived Pages ---');
            console.log(`Total:    ${summary.derivedPages.total}`);
            console.log(`Intact:   ${summary.derivedPages.intact}`);
            console.log(`Mismatch: ${summary.derivedPages.mismatch}`);
            console.log(`Error:    ${summary.derivedPages.error}`);

            console.log('\n--- Assembly Verification ---');
            console.log(`Status:   ${summary.assembly.status} (Valid: ${summary.assembly.valid})`);
            if (summary.assembly.reason) {
                console.log(`Reason:   ${summary.assembly.reason}`);
            }

            if (args.detailed && summary.originalFiles.items.length > 0) {
                console.log('\n--- Detailed Original Files ---');
                for (const file of summary.originalFiles.items) {
                    console.log(`[FILE] Batch: ${file.batchId}, File: ${file.fileId} -> Status: ${file.status}${file.reason ? ` (${file.reason})` : ''}`);
                }
            }

            if (args.detailed && summary.derivedPages.items.length > 0) {
                console.log('\n--- Detailed Derived Pages ---');
                for (const page of summary.derivedPages.items) {
                    console.log(`[PAGE] Page: ${page.pageId}, Batch: ${page.batchId}, File: ${page.fileId}, PageNum: ${page.pageNumber} -> Status: ${page.status}${page.reason ? ` (${page.reason})` : ''}`);
                }
            }

            if (summary.problemRecords.files.length > 0 || summary.problemRecords.pages.length > 0) {
                console.log('\n--- Problem Records ---');
                for (const file of summary.problemRecords.files) {
                    console.log(`[FILE] Batch: ${file.batchId}, File: ${file.fileId} -> Status: ${file.status}${file.reason ? ` (${file.reason})` : ''}`);
                }
                for (const page of summary.problemRecords.pages) {
                    console.log(`[PAGE] Page: ${page.pageId}, Batch: ${page.batchId}, File: ${page.fileId}, PageNum: ${page.pageNumber} -> Status: ${page.status}${page.reason ? ` (${page.reason})` : ''}`);
                }
            }
        }

        const exitCode = (summary.status === 'MISMATCH' || summary.status === 'ERROR') ? 1 : 0;
        process.exitCode = exitCode;
        return exitCode;
    } finally {
        if (shouldDisconnect) {
            await mongoose.disconnect();
        }
    }
}

// Only auto-execute if executed directly
if (typeof require !== 'undefined' && require.main === module) {
    runCli(process.argv.slice(2)).catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    });
}

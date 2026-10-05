import mongoose from 'mongoose';
import AnswerScript from '../models/AnswerScript';
import Batch, { IBatchFile } from '../models/Batch';
import IngestionPage, { IIngestionPage } from '../models/IngestionPage';
import defaultDerivedStorageService, { DerivedStorageService } from './DerivedStorageService';
import defaultImmutableStorageService, { ImmutableStorageService } from './ImmutableStorageService';
import defaultPageIngestionService, { PageIngestionService } from './PageIngestionService';

export interface DerivedPageRepairOptions {
    scriptIds?: string[];
    batchIds?: string[];
    dryRun?: boolean;
}

export interface DerivedPageRepairFailure {
    pageId: string;
    batchId: string;
    fileId: string;
    pageNumber: number;
    reason: string;
}

export interface DerivedPageRepairCandidate {
    pageId: string;
    batchId: string;
    fileId: string;
    pageNumber: number;
    storageKey: string;
}

export interface DerivedPageRepairResult {
    checked: number;
    skipped: number;
    repaired: number;
    wouldRepair: number;
    wouldRepairPages: DerivedPageRepairCandidate[];
    failed: DerivedPageRepairFailure[];
}

type OriginalReader = Pick<ImmutableStorageService, 'readOriginalContent'>;
type DerivedStorage = Pick<DerivedStorageService, 'getDerivedPageKey' | 'derivedPageExists' | 'storeDerivedPage'>;
type PageRegenerator = Pick<PageIngestionService, 'regenerateDerivedPage'>;

export class DerivedPageRepairService {
    private readonly repairsInFlight = new Map<string, Promise<void>>();

    constructor(
        private readonly originalStorage: OriginalReader = defaultImmutableStorageService,
        private readonly derivedStorage: DerivedStorage = defaultDerivedStorageService,
        private readonly pageIngestion: PageRegenerator = defaultPageIngestionService
    ) {}

    async repairPage(pageId: string): Promise<void> {
        const existingRepair = this.repairsInFlight.get(pageId);
        if (existingRepair) return existingRepair;

        const repair = this.repairPageOnce(pageId);
        this.repairsInFlight.set(pageId, repair);
        try {
            await repair;
        } finally {
            if (this.repairsInFlight.get(pageId) === repair) {
                this.repairsInFlight.delete(pageId);
            }
        }
    }

    private async repairPageOnce(pageId: string): Promise<void> {
        const page = await IngestionPage.findById(pageId);
        if (!page) throw new Error(`IngestionPage not found: ${pageId}`);
        const batch = await Batch.findOne({ batchId: page.batchId }).lean();
        const batchFile = batch?.files.find((file) => file.fileIndex === page.fileIndex);
        const expectedKey = this.derivedStorage.getDerivedPageKey(
            page.batchId, page.fileId, page.pageNumber, 'png'
        );
        if (await this.derivedStorage.derivedPageExists(expectedKey)) {
            if (page.storageKey !== expectedKey) {
                await IngestionPage.updateOne({ _id: page._id }, { $set: { storageKey: expectedKey } }, { timestamps: false });
            }
            return;
        }

        const originalStorageKey = this.getOriginalStorageKey(page, batchFile);
        const originalBuffer = await this.originalStorage.readOriginalContent(originalStorageKey);
        const fileType = typeof page.metadata?.fileType === 'string'
            ? page.metadata.fileType
            : batchFile?.fileType;
        if (!fileType) throw new Error('Original file type is unavailable in page metadata and batch file record.');

        const stored = await this.pageIngestion.regenerateDerivedPage({
            batchId: page.batchId,
            fileId: page.fileId,
            pageNumber: page.pageNumber,
            fileType,
            originalStorageKey,
            fileBuffer: originalBuffer
        });
        if (stored.storageKey !== expectedKey) {
            throw new Error(`Page regeneration returned unexpected storage key "${stored.storageKey}".`);
        }
        if (page.storageKey !== expectedKey) {
            await IngestionPage.updateOne({ _id: page._id }, { $set: { storageKey: expectedKey } }, { timestamps: false });
        }
    }

    async repair(options: DerivedPageRepairOptions): Promise<DerivedPageRepairResult> {
        const scriptIds = options.scriptIds || [];
        const batchIds = options.batchIds || [];
        if (scriptIds.length === 0 && batchIds.length === 0) {
            throw new Error('Specify at least one --script or --batch ID.');
        }

        const normalizedScriptIds: string[] = [];
        for (const id of scriptIds) {
            if (!mongoose.isValidObjectId(id)) {
                throw new Error(`Invalid AnswerScript ID: ${id}`);
            }
            normalizedScriptIds.push(new mongoose.Types.ObjectId(id).toString());
        }

        const scriptQueries = [];
        if (normalizedScriptIds.length) scriptQueries.push({ _id: { $in: normalizedScriptIds } });
        if (batchIds.length) scriptQueries.push({ batchId: { $in: batchIds } });
        const scripts = await AnswerScript.find({ $or: scriptQueries });
        const scriptsById = new Map(scripts.map((script) => [script._id.toString(), script]));

        for (const id of normalizedScriptIds) {
            if (!scriptsById.has(id)) {
                throw new Error(`AnswerScript not found: ${id}`);
            }
        }

        const selectedScripts = [...scriptsById.values()];
        if (selectedScripts.length === 0) {
            throw new Error('No AnswerScript records matched the requested IDs or batch IDs.');
        }

        const selectedBatchIds = [...new Set(selectedScripts.map((script) => script.batchId).filter(
            (batchId): batchId is string => Boolean(batchId)
        ))];
        const batches = await Batch.find({ batchId: { $in: selectedBatchIds } }).lean();
        const batchById = new Map(batches.map((batch) => [batch.batchId, batch]));

        const selectedPages = new Map<string, { page: IIngestionPage; batchFile?: IBatchFile }>();

        for (const script of selectedScripts) {
            if (!script.batchId || script.fileIndex === undefined ||
                script.startPageNumber === undefined || script.endPageNumber === undefined) {
                continue;
            }
            const batch = batchById.get(script.batchId);
            const batchFile = batch?.files.find((file) => file.fileIndex === script.fileIndex);
            const pages = await IngestionPage.find({
                batchId: script.batchId,
                fileIndex: script.fileIndex,
                pageNumber: {
                    $gte: script.startPageNumber,
                    $lte: script.endPageNumber
                }
            });
            for (const page of pages) {
                selectedPages.set(page._id.toString(), { page, batchFile });
            }
        }

        const result: DerivedPageRepairResult = {
            checked: 0,
            skipped: 0,
            repaired: 0,
            wouldRepair: 0,
            wouldRepairPages: [],
            failed: []
        };

        for (const { page, batchFile } of selectedPages.values()) {
            result.checked += 1;
            const expectedKey = this.derivedStorage.getDerivedPageKey(
                page.batchId,
                page.fileId,
                page.pageNumber,
                'png'
            );

            try {
                if (await this.derivedStorage.derivedPageExists(expectedKey)) {
                    if (page.storageKey !== expectedKey && !options.dryRun) {
                        await IngestionPage.updateOne(
                            { _id: page._id },
                            { $set: { storageKey: expectedKey } },
                            { timestamps: false }
                        );
                    }
                    result.skipped += 1;
                    continue;
                }

                if (options.dryRun) {
                    result.wouldRepair += 1;
                    result.wouldRepairPages.push({
                        pageId: page._id.toString(),
                        batchId: page.batchId,
                        fileId: page.fileId,
                        pageNumber: page.pageNumber,
                        storageKey: expectedKey
                    });
                    continue;
                }

                const originalStorageKey = this.getOriginalStorageKey(page, batchFile);
                const originalBuffer = await this.originalStorage.readOriginalContent(originalStorageKey);
                const fileType = typeof page.metadata?.fileType === 'string'
                    ? page.metadata.fileType
                    : batchFile?.fileType;
                if (!fileType) {
                    throw new Error('Original file type is unavailable in page metadata and batch file record.');
                }

                const stored = await this.pageIngestion.regenerateDerivedPage({
                    batchId: page.batchId,
                    fileId: page.fileId,
                    pageNumber: page.pageNumber,
                    fileType,
                    originalStorageKey,
                    fileBuffer: originalBuffer
                });
                if (stored.storageKey !== expectedKey) {
                    throw new Error(`Page regeneration returned unexpected storage key "${stored.storageKey}".`);
                }

                await IngestionPage.updateOne(
                    { _id: page._id },
                    { $set: { storageKey: expectedKey } },
                    { timestamps: false }
                );
                result.repaired += 1;
            } catch (error) {
                result.failed.push({
                    pageId: page._id.toString(),
                    batchId: page.batchId,
                    fileId: page.fileId,
                    pageNumber: page.pageNumber,
                    reason: error instanceof Error ? error.message : String(error)
                });
            }
        }

        return result;
    }

    private getOriginalStorageKey(
        page: { metadata?: Record<string, unknown>; fileId: string },
        batchFile?: IBatchFile
    ): string {
        const metadataKey = page.metadata?.originalStorageKey;
        const storageKey = typeof metadataKey === 'string' && metadataKey.startsWith('batches/')
            ? metadataKey
            : batchFile?.storageKey;
        if (!storageKey || !storageKey.startsWith('batches/')) {
            throw new Error('Original storage key is unavailable for this page.');
        }
        return storageKey;
    }
}

const derivedPageRepairService = new DerivedPageRepairService();
export default derivedPageRepairService;

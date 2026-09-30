import mongoose from 'mongoose';
import AnswerScript, { IAnswerScript, IdentificationStatus } from '../../models/AnswerScript';
import Page, { IPage } from '../../models/Page';
import IngestionPage, { IIngestionPage } from '../../models/IngestionPage';
import derivedStorageService, { IDerivedStorageService } from '../DerivedStorageService';
import { HttpError } from '../../lib/errors';

export interface IResolvedAnswerSheetPage {
    answerScriptId: string;
    studentId: string;
    pageNumber: number;
    pageId?: string;
    sourceReference: string;
    imageBuffer: Buffer;
    width?: number;
    height?: number;
}

export interface TrustedStudentResolution {
    answerScript: IAnswerScript;
    studentId: string;
}

/**
 * Research-only adapter responsible for resolving AnswerScript -> trusted student identity ->
 * physical page records -> rendered image buffers using existing project storage infrastructure.
 *
 * NOTE: Strictly isolated from production grading. Never modifies AnswerScript or Page records.
 */
export class AnswerSheetSourceAdapter {
    constructor(
        private readonly derivedStorage: IDerivedStorageService = derivedStorageService
    ) {}

    private isValidObjectId(id: string): boolean {
        return !!id && mongoose.Types.ObjectId.isValid(id) && id.length === 24;
    }

    /**
     * Resolves the trusted student identity bound to an AnswerScript.
     * Enforces that student identity comes strictly from the verified AnswerScript mapping.
     * Rejects any client-supplied studentId that conflicts with the trusted record.
     */
    public async resolveAnswerScriptStudent(
        answerScriptId: string,
        candidateStudentId?: string
    ): Promise<TrustedStudentResolution> {
        if (!this.isValidObjectId(answerScriptId)) {
            throw new HttpError(`Invalid AnswerScript ID format: ${answerScriptId}`, 400);
        }

        const answerScript = await AnswerScript.findById(answerScriptId);
        if (!answerScript) {
            throw new HttpError(`AnswerScript not found: ${answerScriptId}`, 404);
        }

        // Verify trusted student identification status
        if (!answerScript.student || answerScript.identificationStatus !== IdentificationStatus.IDENTIFIED) {
            throw new HttpError(
                `AnswerScript ${answerScriptId} has no verified student mapping (identificationStatus: ${answerScript.identificationStatus || 'UNIDENTIFIED'})`,
                422
            );
        }

        const trustedStudentId = answerScript.student.toString();

        // Enforce that arbitrary client-supplied student ID cannot override trusted mapping
        if (candidateStudentId) {
            if (!this.isValidObjectId(candidateStudentId)) {
                throw new HttpError(`Invalid candidate student ID format: ${candidateStudentId}`, 400);
            }
            if (candidateStudentId !== trustedStudentId) {
                throw new HttpError(
                    `Security violation: supplied studentId ${candidateStudentId} does not match trusted AnswerScript student mapping ${trustedStudentId}`,
                    403
                );
            }
        }

        return {
            answerScript,
            studentId: trustedStudentId
        };
    }

    /**
     * Resolves rendered high-resolution image buffer for a page using existing DerivedStorageService.
     */
    public async resolvePageBuffer(storageKeyOrPath: string): Promise<Buffer> {
        if (!storageKeyOrPath) {
            throw new HttpError('Storage key or path is required to resolve page buffer', 400);
        }

        if (this.derivedStorage.readDerivedPage) {
            return await this.derivedStorage.readDerivedPage(storageKeyOrPath);
        }

        throw new HttpError('DerivedStorageService does not support readDerivedPage', 500);
    }

    /**
     * Resolves physical pages and their rendered image buffers for an AnswerScript.
     * Queries existing Page or IngestionPage models without altering ingestion behavior.
     */
    public async resolveAnswerSheetPages(
        answerScriptId: string,
        candidateStudentId?: string
    ): Promise<IResolvedAnswerSheetPage[]> {
        const { answerScript, studentId } = await this.resolveAnswerScriptStudent(
            answerScriptId,
            candidateStudentId
        );

        const answerScriptOid = answerScript._id as mongoose.Types.ObjectId;
        const resolvedPages: IResolvedAnswerSheetPage[] = [];

        // 1. Try finding pages in the production Page model
        const productionPages: IPage[] = await Page.find({
            answerScript: answerScriptOid,
            isActive: true
        }).sort({ pageNumber: 1 });

        if (productionPages.length > 0) {
            for (const p of productionPages) {
                try {
                    const buffer = await this.resolvePageBuffer(p.imagePath);
                    resolvedPages.push({
                        answerScriptId,
                        studentId,
                        pageNumber: p.pageNumber,
                        pageId: p._id ? p._id.toString() : undefined,
                        sourceReference: `script_${answerScriptId}_p${p.pageNumber}`,
                        imageBuffer: buffer
                    });
                } catch {
                    // Skip unreadable pages gracefully
                }
            }
            if (resolvedPages.length > 0) {
                return resolvedPages;
            }
        }

        // 2. Fallback: Query IngestionPage model
        const ingestionPages: IIngestionPage[] = await IngestionPage.find({
            answerScript: answerScriptOid
        }).sort({ pageNumber: 1 });

        if (ingestionPages.length > 0) {
            for (const ip of ingestionPages) {
                try {
                    const buffer = await this.resolvePageBuffer(ip.storageKey);
                    resolvedPages.push({
                        answerScriptId,
                        studentId,
                        pageNumber: ip.pageNumber,
                        pageId: ip._id ? ip._id.toString() : undefined,
                        sourceReference: `script_${answerScriptId}_p${ip.pageNumber}`,
                        imageBuffer: buffer,
                        width: ip.width,
                        height: ip.height
                    });
                } catch {
                    // Skip unreadable pages gracefully
                }
            }
            if (resolvedPages.length > 0) {
                return resolvedPages;
            }
        }

        return resolvedPages;
    }
}

export const answerSheetSourceAdapter = new AnswerSheetSourceAdapter();
export default answerSheetSourceAdapter;

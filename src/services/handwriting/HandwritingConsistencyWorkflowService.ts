import mongoose from 'mongoose';
import {
    ComparisonMatchState,
    IBoundingBox,
    IHandwritingFeatures,
    IHandwritingProfileData,
    ProfileStatus,
    SampleExtractionStatus
} from '../../models/HandwritingConsistency';
import { IHandwritingSampleDocument, HandwritingSampleType } from '../../models/HandwritingSample';
import { IHandwritingProfileDocument } from '../../models/HandwritingProfile';
import { IHandwritingComparisonDocument } from '../../models/HandwritingComparison';
import { HandwritingSampleRepository, handwritingSampleRepository } from '../../repositories/HandwritingSampleRepository';
import { HandwritingProfileRepository, handwritingProfileRepository } from '../../repositories/HandwritingProfileRepository';
import { HandwritingComparisonRepository, handwritingComparisonRepository } from '../../repositories/HandwritingComparisonRepository';
import { HandwritingFeatureExtractor } from './HandwritingFeatureExtractor';
import { HandwritingProfileBuilder, HandwritingSampleInput } from './HandwritingProfileBuilder';
import { HandwritingComparisonEngine } from './HandwritingComparisonEngine';
import { UserRole, SYSTEM_ROLE } from '../../constants/permissions';
import { HttpError } from '../../lib/errors';

export interface HandwritingAuthContext {
    userId: string;
    role: UserRole | string;
}

export interface RegisterSampleWorkflowInput {
    studentId: string;
    sourceReference?: string;
    sampleType?: HandwritingSampleType;
    imageBuffer?: Buffer;
    features?: IHandwritingFeatures;
    boundingBox?: IBoundingBox;
    pageNumber?: number;
    answerScriptId?: string;
    autoRebuildProfile?: boolean;
}

export interface RegisterSampleWorkflowResult {
    sample: IHandwritingSampleDocument;
    isDuplicate: boolean;
    profile?: IHandwritingProfileDocument | null;
}

export interface CompareSampleWorkflowInput {
    sampleId?: string;
    imageBuffer?: Buffer;
    features?: IHandwritingFeatures;
    boundingBox?: IBoundingBox;
    sourceReference?: string;
    pageNumber?: number;
    answerScriptId?: string;
}

/**
 * Validates whether the acting user is authorized to access the given student's data.
 * - Staff roles (ADMIN, PROFESSOR, TA, SYSTEM) may access student records.
 * - Students may ONLY access their own records.
 */
export function isAuthorizedForStudent(
    authContext: HandwritingAuthContext,
    studentId: string
): boolean {
    if (!authContext || !authContext.userId || !authContext.role) {
        return false;
    }
    const staffRoles = [UserRole.ADMIN, UserRole.PROFESSOR, UserRole.TA, SYSTEM_ROLE];
    if (staffRoles.includes(authContext.role as UserRole)) {
        return true;
    }
    if (authContext.role === UserRole.STUDENT && authContext.userId === studentId) {
        return true;
    }
    return false;
}

/**
 * End-to-end orchestration service for persistent handwriting sample registration,
 * profile versioning, and sample comparison.
 *
 * NOTE: This is a research-only workflow service strictly isolated from production grading.
 */
export class HandwritingConsistencyWorkflowService {
    constructor(
        private readonly sampleRepo: HandwritingSampleRepository = handwritingSampleRepository,
        private readonly profileRepo: HandwritingProfileRepository = handwritingProfileRepository,
        private readonly comparisonRepo: HandwritingComparisonRepository = handwritingComparisonRepository,
        private readonly featureExtractor: HandwritingFeatureExtractor = new HandwritingFeatureExtractor(),
        private readonly profileBuilder: HandwritingProfileBuilder = new HandwritingProfileBuilder(),
        private readonly comparisonEngine: HandwritingComparisonEngine = new HandwritingComparisonEngine()
    ) {}

    private isValidObjectId(id: string): boolean {
        return !!id && mongoose.Types.ObjectId.isValid(id) && id.length === 24;
    }

    private verifyAccess(authContext: HandwritingAuthContext, studentId: string): void {
        if (!this.isValidObjectId(studentId)) {
            throw new HttpError('Invalid student ID format: must be a 24-character hexadecimal ObjectId', 400);
        }
        if (!isAuthorizedForStudent(authContext, studentId)) {
            throw new HttpError('Unauthorized: access denied to student handwriting data', 403);
        }
    }

    /**
     * Executes an operation within a MongoDB transaction if the connected topology supports it.
     * Falls back to non-transactional execution on standalone instances (e.g. in tests).
     */
    private async withTransaction<T>(fn: (session?: mongoose.ClientSession) => Promise<T>): Promise<T> {
        const connection = mongoose.connection;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const topology = (connection.getClient() as any)?.topology;
        const topologyType = (topology?.description?.type as string | undefined) ?? 'Unknown';

        const transactionCapable = [
            'ReplicaSetWithPrimary',
            'ReplicaSetNoPrimary',
            'Sharded',
            'LoadBalanced'
        ].includes(topologyType);

        if (!transactionCapable) {
            return await fn(undefined);
        }

        const session = await mongoose.startSession();
        try {
            session.startTransaction();
            const result = await fn(session);
            await session.commitTransaction();
            return result;
        } catch (error) {
            try {
                await session.abortTransaction();
            } catch {
                // Ignore abort errors
            }
            throw error;
        } finally {
            session.endSession();
        }
    }

    /**
     * 1. registerSample()
     * Registers and persists a handwriting sample for a student.
     * Deduplicates by sourceReference if provided.
     * Rebuilds profile if usable and autoRebuildProfile is true (default: true).
     */
    public async registerSample(
        input: RegisterSampleWorkflowInput,
        authContext: HandwritingAuthContext
    ): Promise<RegisterSampleWorkflowResult> {
        this.verifyAccess(authContext, input.studentId);

        const studentOid = new mongoose.Types.ObjectId(input.studentId);

        // Check for duplicate source registration
        if (input.sourceReference) {
            const existingSample = await this.sampleRepo.findBySourceReference(
                input.studentId,
                input.sourceReference
            );
            if (existingSample) {
                const currentProfile = await this.profileRepo.findByStudent(input.studentId);
                return {
                    sample: existingSample,
                    isDuplicate: true,
                    profile: currentProfile
                };
            }
        }

        // Feature extraction and quality validation
        let status: SampleExtractionStatus = SampleExtractionStatus.ERROR;
        let features: IHandwritingFeatures | undefined = input.features;
        let disqualificationReason: string | undefined;

        if (features) {
            status = features.quality?.isSufficient
                ? SampleExtractionStatus.VALID
                : SampleExtractionStatus.INSUFFICIENT_SAMPLE;
        } else if (input.imageBuffer) {
            const extractRes = await this.featureExtractor.extractFeatures(
                input.imageBuffer,
                input.boundingBox
            );
            status = extractRes.status;
            features = extractRes.features;
            disqualificationReason = extractRes.disqualificationReason;
        } else {
            status = SampleExtractionStatus.ERROR;
            disqualificationReason = 'No image buffer or feature vector provided';
        }

        const isUsable = status === SampleExtractionStatus.VALID && (features?.quality?.isSufficient ?? false);

        const sampleDocData: Partial<IHandwritingSampleDocument> = {
            student: studentOid,
            sourceReference: input.sourceReference?.trim(),
            sampleType: input.sampleType || 'EXAM_SCRIPT',
            answerScriptId: input.answerScriptId && this.isValidObjectId(input.answerScriptId)
                ? new mongoose.Types.ObjectId(input.answerScriptId)
                : undefined,
            pageNumber: input.pageNumber,
            boundingBox: input.boundingBox,
            status,
            isUsable,
            disqualificationReason,
            rawVector: isUsable && features ? features.rawVector : undefined,
            features,
            quality: features?.quality,
            extractionVersion: '1.0.0'
        };

        const savedSample = await this.sampleRepo.create(sampleDocData);

        // Auto-rebuild profile if usable and requested
        let profile: IHandwritingProfileDocument | null = null;
        const autoRebuild = input.autoRebuildProfile ?? true;

        if (isUsable && autoRebuild) {
            profile = await this.rebuildProfile(input.studentId, authContext);
        } else {
            profile = await this.profileRepo.findByStudent(input.studentId);
        }

        return {
            sample: savedSample,
            isDuplicate: false,
            profile
        };
    }

    /**
     * 2. rebuildProfile()
     * Aggregates all usable samples for a student and builds an explicitly versioned profile.
     * Preserves previous profile versions intact without destructive mutation.
     * Reuses existing profile if the usable sample set is unchanged.
     */
    public async rebuildProfile(
        studentId: string,
        authContext: HandwritingAuthContext
    ): Promise<IHandwritingProfileDocument> {
        this.verifyAccess(authContext, studentId);

        const usableSamples = await this.sampleRepo.findByStudent(studentId, { usableOnly: true, sortOrder: 'asc' });
        const currentProfile = await this.profileRepo.findByStudent(studentId);

        // Check if existing profile already covers the exact same usable samples
        if (currentProfile && currentProfile.samplesUsed.length === usableSamples.length) {
            const currentSampleIds = currentProfile.samplesUsed.map(id => id.toString()).sort();
            const newSampleIds = usableSamples.map(s => s._id.toString()).sort();
            const isIdentical = currentSampleIds.every((id, idx) => id === newSampleIds[idx]);

            if (isIdentical) {
                return currentProfile;
            }
        }

        // Map usable sample documents to HandwritingSampleInput
        const sampleInputs: HandwritingSampleInput[] = usableSamples.map(s => ({
            sampleId: s._id.toString(),
            studentId,
            features: s.features,
            status: s.status,
            pageNumber: s.pageNumber,
            answerScriptId: s.answerScriptId?.toString(),
            extractedAt: s.createdAt
        }));

        // Execute in-memory mathematical profile builder
        const buildResult = await this.profileBuilder.buildProfile(studentId, sampleInputs);
        const { profile: builtProfile } = buildResult;

        // If current profile is PROVISIONAL, update it in place until it becomes ESTABLISHED (as Version 1)
        if (currentProfile && currentProfile.status === ProfileStatus.PROVISIONAL) {
            currentProfile.sampleCount = builtProfile.sampleCount;
            currentProfile.samplesUsed = usableSamples.map(s => s._id as mongoose.Types.ObjectId);
            currentProfile.featureMeans = builtProfile.featureMeans;
            currentProfile.featureStdDevs = builtProfile.featureStdDevs;
            currentProfile.status = builtProfile.status;
            currentProfile.profileVersion = 1;
            currentProfile.isCurrent = true;
            return await currentProfile.save();
        }

        // If no profile exists yet, create Version 1 (either PROVISIONAL or ESTABLISHED)
        if (!currentProfile) {
            const profileToCreate: Partial<IHandwritingProfileDocument> = {
                student: new mongoose.Types.ObjectId(studentId),
                sampleCount: builtProfile.sampleCount,
                samplesUsed: usableSamples.map(s => s._id as mongoose.Types.ObjectId),
                featureMeans: builtProfile.featureMeans,
                featureStdDevs: builtProfile.featureStdDevs,
                status: builtProfile.status,
                profileVersion: 1,
                extractionVersion: '1.0.0',
                isCurrent: true
            };
            return await this.profileRepo.create(profileToCreate);
        }

        // An ESTABLISHED profile already exists: adding new samples creates a NEW version (v2, v3, ...)
        const latestVersionNumber = await this.profileRepo.getLatestVersionNumber(studentId);
        const newVersionNumber = latestVersionNumber + 1;

        // Persist new profile version inside a transaction
        return await this.withTransaction(async session => {
            // Mark all existing profiles for this student as not current
            await this.profileRepo.markPreviousAsOld(studentId, session);

            const profileToCreate: Partial<IHandwritingProfileDocument> = {
                student: new mongoose.Types.ObjectId(studentId),
                sampleCount: builtProfile.sampleCount,
                samplesUsed: usableSamples.map(s => s._id as mongoose.Types.ObjectId),
                featureMeans: builtProfile.featureMeans,
                featureStdDevs: builtProfile.featureStdDevs,
                status: builtProfile.status,
                profileVersion: newVersionNumber,
                extractionVersion: '1.0.0',
                isCurrent: true
            };

            return await this.profileRepo.create(profileToCreate, session);
        });
    }

    /**
     * 3. compareSample()
     * Compares a candidate sample against the student's current profile.
     * Persists an immutable comparison record referencing the exact profile version used.
     */
    public async compareSample(
        studentId: string,
        input: CompareSampleWorkflowInput,
        authContext: HandwritingAuthContext
    ): Promise<IHandwritingComparisonDocument> {
        this.verifyAccess(authContext, studentId);

        const currentProfile = await this.profileRepo.findByStudent(studentId);

        // Resolve candidate sample
        let sampleDoc: IHandwritingSampleDocument | null = null;
        let sampleInputForEngine: HandwritingSampleInput;

        if (input.sampleId) {
            if (!this.isValidObjectId(input.sampleId)) {
                throw new HttpError('Invalid sample ID format', 400);
            }
            sampleDoc = await this.sampleRepo.findById(input.sampleId, studentId);
            if (!sampleDoc) {
                throw new HttpError(`Handwriting sample not found or access denied: ${input.sampleId}`, 404);
            }
            sampleInputForEngine = {
                sampleId: sampleDoc._id.toString(),
                features: sampleDoc.features,
                status: sampleDoc.status,
                pageNumber: sampleDoc.pageNumber
            };
        } else if (input.imageBuffer || input.features) {
            // Register as an evaluation sample record
            const regResult = await this.registerSample({
                studentId,
                sourceReference: input.sourceReference,
                imageBuffer: input.imageBuffer,
                features: input.features,
                boundingBox: input.boundingBox,
                pageNumber: input.pageNumber,
                answerScriptId: input.answerScriptId,
                sampleType: 'GENERAL_SUBMISSION',
                autoRebuildProfile: false // Comparisons do not automatically alter baseline profiles
            }, authContext);
            sampleDoc = regResult.sample;
            sampleInputForEngine = {
                sampleId: sampleDoc._id.toString(),
                features: sampleDoc.features,
                status: sampleDoc.status,
                pageNumber: sampleDoc.pageNumber
            };
        } else {
            throw new HttpError('Either sampleId, imageBuffer, or features must be provided for comparison', 400);
        }

        // Convert Mongoose profile document to clean Phase 2 IHandwritingProfileData interface
        const profileData: IHandwritingProfileData = currentProfile
            ? {
                studentId: currentProfile.student.toString(),
                sampleCount: currentProfile.sampleCount,
                featureMeans: currentProfile.featureMeans,
                featureStdDevs: currentProfile.featureStdDevs,
                status: currentProfile.status,
                samplesUsed: currentProfile.samplesUsed.map(id => id.toString()),
                createdAt: currentProfile.createdAt,
                updatedAt: currentProfile.updatedAt
            }
            : {
                studentId,
                sampleCount: 0,
                featureMeans: new Array(8).fill(0),
                featureStdDevs: new Array(8).fill(0),
                status: ProfileStatus.PROVISIONAL,
                samplesUsed: [],
                createdAt: new Date(),
                updatedAt: new Date()
            };

        // Run Phase 2 comparison engine
        const comparisonResult = await this.comparisonEngine.compare(profileData, sampleInputForEngine);

        // Persist immutable comparison record referencing the exact profile version
        const comparisonDocData: Partial<IHandwritingComparisonDocument> = {
            student: new mongoose.Types.ObjectId(studentId),
            profile: currentProfile?._id as mongoose.Types.ObjectId | undefined,
            profileVersion: currentProfile?.profileVersion,
            sample: sampleDoc._id as mongoose.Types.ObjectId,
            status: comparisonResult.status,
            distance: comparisonResult.distance,
            confidence: comparisonResult.confidence,
            featureDeviations: comparisonResult.featureDeviations,
            anomalyFactors: comparisonResult.anomalyFactors,
            sampleQuality: comparisonResult.sampleQuality,
            comparedAt: comparisonResult.comparedAt
        };

        return await this.comparisonRepo.create(comparisonDocData);
    }

    /**
     * 4. getStudentProfile()
     * Retrieves a student's profile. Returns specific version if specified, else current profile.
     */
    public async getStudentProfile(
        studentId: string,
        authContext: HandwritingAuthContext,
        version?: number
    ): Promise<IHandwritingProfileDocument | null> {
        this.verifyAccess(authContext, studentId);

        if (version !== undefined && version > 0) {
            return await this.profileRepo.findByStudentAndVersion(studentId, version);
        }

        return await this.profileRepo.findByStudent(studentId);
    }

    /**
     * 5. getStudentComparisons()
     * Retrieves all comparison records scoped to a student.
     */
    public async getStudentComparisons(
        studentId: string,
        authContext: HandwritingAuthContext,
        options?: { limit?: number; status?: ComparisonMatchState }
    ): Promise<IHandwritingComparisonDocument[]> {
        this.verifyAccess(authContext, studentId);
        return await this.comparisonRepo.findByStudent(studentId, options);
    }

    /**
     * 6. getStudentSamples()
     * Retrieves all samples registered for a student.
     */
    public async getStudentSamples(
        studentId: string,
        authContext: HandwritingAuthContext,
        options?: { usableOnly?: boolean; limit?: number }
    ): Promise<IHandwritingSampleDocument[]> {
        this.verifyAccess(authContext, studentId);
        return await this.sampleRepo.findByStudent(studentId, options);
    }
}

export const handwritingConsistencyWorkflowService = new HandwritingConsistencyWorkflowService();
export default handwritingConsistencyWorkflowService;

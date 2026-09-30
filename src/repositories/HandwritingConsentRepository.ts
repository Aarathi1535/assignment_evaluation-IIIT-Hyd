import mongoose from 'mongoose';
import HandwritingConsentModel, {
    IHandwritingConsentDocument,
    HANDWRITING_RETENTION_POLICY
} from '../models/HandwritingConsent';

export interface SetConsentOptions {
    retentionDays?: number;
    notes?: string;
    consentVersion?: string;
}

export class HandwritingConsentRepository {
    private isValidObjectId(id: string): boolean {
        return !!id && mongoose.Types.ObjectId.isValid(id) && id.length === 24;
    }

    /**
     * Finds consent record for a student.
     */
    async findByStudent(studentId: string): Promise<IHandwritingConsentDocument | null> {
        if (!this.isValidObjectId(studentId)) {
            return null;
        }

        return await HandwritingConsentModel.findOne({
            student: new mongoose.Types.ObjectId(studentId)
        });
    }

    /**
     * Records or updates explicit student consent.
     * Stores whether consent was given, timestamp, and calculates retention expiry.
     */
    async setConsent(
        studentId: string,
        hasConsented: boolean,
        options?: SetConsentOptions,
        session?: mongoose.ClientSession
    ): Promise<IHandwritingConsentDocument> {
        if (!this.isValidObjectId(studentId)) {
            throw new Error('Invalid student ID format for consent');
        }

        const now = new Date();
        const retentionDays = options?.retentionDays ?? HANDWRITING_RETENTION_POLICY.DEFAULT_RETENTION_DAYS;
        const studentOid = new mongoose.Types.ObjectId(studentId);

        let consentDoc = await HandwritingConsentModel.findOne({ student: studentOid }).session(session || null);

        if (!consentDoc) {
            consentDoc = new HandwritingConsentModel({
                student: studentOid,
                hasConsented,
                retentionDays,
                consentVersion: options?.consentVersion ?? '1.0',
                notes: options?.notes
            });
        } else {
            consentDoc.hasConsented = hasConsented;
            consentDoc.retentionDays = retentionDays;
            if (options?.consentVersion) {
                consentDoc.consentVersion = options.consentVersion;
            }
            if (options?.notes) {
                consentDoc.notes = options.notes;
            }
        }

        if (hasConsented) {
            consentDoc.consentedAt = now;
            consentDoc.revokedAt = undefined;
            consentDoc.retentionExpiresAt = new Date(now.getTime() + retentionDays * 24 * 60 * 60 * 1000);
        } else {
            consentDoc.revokedAt = now;
            // Revocation immediately sets retention expiration to now
            consentDoc.retentionExpiresAt = now;
        }

        return await consentDoc.save({ session });
    }

    /**
     * Checks if a student currently has active, unexpired consent.
     */
    async hasActiveConsent(studentId: string): Promise<boolean> {
        if (!this.isValidObjectId(studentId)) {
            return false;
        }

        const consent = await this.findByStudent(studentId);
        if (!consent || !consent.hasConsented) {
            return false;
        }

        if (consent.retentionExpiresAt && consent.retentionExpiresAt.getTime() <= Date.now()) {
            return false;
        }

        return true;
    }
}

export const handwritingConsentRepository = new HandwritingConsentRepository();
export default handwritingConsentRepository;

import mongoose from 'mongoose';
import HandwritingProfileModel, { IHandwritingProfileDocument } from '../models/HandwritingProfile';

export class HandwritingProfileRepository {
    private isValidObjectId(id: string): boolean {
        return !!id && mongoose.Types.ObjectId.isValid(id) && id.length === 24;
    }

    /**
     * Creates and persists a new profile version.
     */
    async create(
        data: Partial<IHandwritingProfileDocument>,
        session?: mongoose.ClientSession
    ): Promise<IHandwritingProfileDocument> {
        const profile = new HandwritingProfileModel(data);
        return await profile.save({ session });
    }

    /**
     * Finds the current active profile for a student.
     * Falls back to the highest profileVersion if no isCurrent document is marked.
     */
    async findByStudent(studentId: string): Promise<IHandwritingProfileDocument | null> {
        if (!this.isValidObjectId(studentId)) {
            return null;
        }

        const studentOid = new mongoose.Types.ObjectId(studentId);

        // First attempt to find the current active profile
        const currentProfile = await HandwritingProfileModel.findOne({
            student: studentOid,
            isCurrent: true
        });

        if (currentProfile) {
            return currentProfile;
        }

        // Fallback: return the highest version profile for this student
        return await HandwritingProfileModel.findOne({
            student: studentOid
        }).sort({ profileVersion: -1 });
    }

    /**
     * Finds a specific historical profile version for a student.
     * Strictly verifies student ownership.
     */
    async findByStudentAndVersion(
        studentId: string,
        version: number
    ): Promise<IHandwritingProfileDocument | null> {
        if (!this.isValidObjectId(studentId) || !Number.isInteger(version) || version < 1) {
            return null;
        }

        return await HandwritingProfileModel.findOne({
            student: new mongoose.Types.ObjectId(studentId),
            profileVersion: version
        });
    }

    /**
     * Marks all existing profiles for a student as not current before inserting a new version.
     */
    async markPreviousAsOld(
        studentId: string,
        session?: mongoose.ClientSession
    ): Promise<void> {
        if (!this.isValidObjectId(studentId)) {
            return;
        }

        await HandwritingProfileModel.updateMany(
            { student: new mongoose.Types.ObjectId(studentId), isCurrent: true },
            { $set: { isCurrent: false } },
            { session }
        );
    }

    /**
     * Returns the latest profile version number for a student (0 if none exist).
     */
    async getLatestVersionNumber(studentId: string): Promise<number> {
        if (!this.isValidObjectId(studentId)) {
            return 0;
        }

        const latest = await HandwritingProfileModel.findOne({
            student: new mongoose.Types.ObjectId(studentId)
        })
            .sort({ profileVersion: -1 })
            .select('profileVersion')
            .lean();

        return latest ? latest.profileVersion : 0;
    }

    /**
     * Returns all historical versions for a student, sorted ascending by version number.
     */
    async getAllVersionsForStudent(studentId: string): Promise<IHandwritingProfileDocument[]> {
        if (!this.isValidObjectId(studentId)) {
            return [];
        }

        return await HandwritingProfileModel.find({
            student: new mongoose.Types.ObjectId(studentId)
        }).sort({ profileVersion: 1 });
    }
}

export const handwritingProfileRepository = new HandwritingProfileRepository();
export default handwritingProfileRepository;

/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose from 'mongoose';
import crypto from 'crypto';
import Exam from '../models/Exam';
import StudentMapping from '../models/StudentMapping';
import AnswerScript from '../models/AnswerScript';
import { UserRole } from '../constants/permissions';

export interface ViewerContext {
    id: string;
    role?: UserRole | string;
}

export class Anonymizer {
    /**
     * Helper to check if blind grading is active for a given exam and viewer context.
     * Deny-by-default/anonymize-by-default: if exam or viewer info is missing,
     * but the exam is set to blind-grading, we anonymize.
     */
    static async isBlindActive(examId?: string | mongoose.Types.ObjectId, viewer?: ViewerContext): Promise<boolean> {
        // Professor and Admin roles are exempt from anonymization (privileged roles)
        if (viewer && (viewer.role === UserRole.PROFESSOR || viewer.role === UserRole.ADMIN)) {
            return false;
        }

        // Treat invalid, missing, unrecognized viewer roles as non-privileged and fail closed
        // (If viewer or viewer.role is missing/unrecognized, we resolve in the privacy-safe direction)
        const isViewerRoleRecognized = !!(
            viewer &&
            viewer.role &&
            Object.values(UserRole).includes(viewer.role as UserRole)
        );

        if (!isViewerRoleRecognized) {
            return true;
        }

        // If examId is missing or unresolved, fail closed
        if (!examId) {
            return true;
        }

        const exam = await Exam.findById(examId).lean();
        // If Exam cannot be resolved or is set to blindGrading, anonymize
        if (!exam || exam.blindGrading) {
            return true;
        }

        return false;
    }

    /**
     * Serializes a single AnswerScript document/object.
     */
    static async serializeAnswerScript(
        script: any,
        viewer: ViewerContext,
        anonymousIdMap?: Record<string, string>,
        blindActiveMap?: Record<string, boolean>
    ): Promise<Record<string, any>> {
        if (!script) return {};

        // Convert mongoose documents to plain objects
        let scriptObj = typeof script.toObject === 'function' ? script.toObject() : script;

        if (scriptObj instanceof mongoose.Types.ObjectId || (scriptObj && typeof scriptObj === 'object' && !scriptObj._id && mongoose.Types.ObjectId.isValid(scriptObj.toString())) || (typeof scriptObj === 'string' && mongoose.Types.ObjectId.isValid(scriptObj))) {
            scriptObj = { _id: scriptObj };
        }

        const examId = scriptObj.exam?._id || scriptObj.exam;
        const examIdStr = examId?.toString();
        
        let isBlind: boolean;
        if (blindActiveMap && examIdStr && examIdStr in blindActiveMap) {
            isBlind = blindActiveMap[examIdStr];
        } else {
            isBlind = await this.isBlindActive(examIdStr, viewer);
        }

        if (isBlind) {
            const studentId = scriptObj.student?._id || scriptObj.student;
            const studentIdStr = studentId?.toString();

            let anonymousId = 'ANONYMOUS';
            let scriptReference = '';

            if (studentIdStr) {
                const compositeKey = examIdStr ? `${examIdStr}:${studentIdStr}` : studentIdStr;
                if (anonymousIdMap && anonymousIdMap[compositeKey]) {
                    anonymousId = anonymousIdMap[compositeKey];
                } else if (examIdStr) {
                    const mapping = await StudentMapping.findOne({
                        exam: examIdStr,
                        student: studentIdStr
                    }).lean();
                    if (mapping) {
                        anonymousId = mapping.anonymousId;
                    }
                }
            }

            if (anonymousId && anonymousId !== 'ANONYMOUS') {
                scriptReference = `Script #${anonymousId}`;
            } else {
                const scriptId = (scriptObj._id || '').toString();
                const secret = process.env.ORIGINAL_STORAGE_HMAC_SECRET;
                if (!secret || secret.trim() === '') {
                    throw new Error('ORIGINAL_STORAGE_HMAC_SECRET is missing or not configured');
                }
                const hmac = crypto.createHmac('sha256', secret).update(scriptId).digest('hex');
                const suffix = hmac.slice(0, 6).toUpperCase();
                scriptReference = `Script #UNASSIGNED-${suffix}`;
            }

            // Minimal safe allowlist for blind-mode output (omits filePath, filename, batchId, manualIdReason, etc.)
            return {
                _id: scriptObj._id?.toString() || scriptObj._id,
                exam: examIdStr,
                anonymousId,
                scriptReference,
                startPageNumber: scriptObj.startPageNumber,
                endPageNumber: scriptObj.endPageNumber,
                pageCount: scriptObj.pageCount,
                isActive: scriptObj.isActive,
                createdAt: scriptObj.createdAt,
                updatedAt: scriptObj.updatedAt
            };
        }

        // Professor/Admin or non-blind mode: return original plain object
        return scriptObj;
    }

    /**
     * Serializes multiple AnswerScript documents/objects.
     */
    static async serializeAnswerScripts(
        scripts: any[],
        viewer: ViewerContext
    ): Promise<Record<string, any>[]> {
        if (!scripts || scripts.length === 0) return [];

        // Pre-fetch student mappings to prevent N+1 queries
        const examIds = Array.from(
            new Set(
                scripts
                    .map(s => {
                        const sObj = typeof s.toObject === 'function' ? s.toObject() : s;
                        const exam = sObj.exam?._id || sObj.exam;
                        return exam?.toString();
                    })
                    .filter(Boolean)
            )
        );

        const anonymousIdMap: Record<string, string> = {};
        const blindActiveMap: Record<string, boolean> = {};

        if (examIds.length > 0) {
            const mappings = await StudentMapping.find({ exam: { $in: examIds } }).lean();
            for (const m of mappings) {
                if (m.student && m.exam) {
                    const key = `${m.exam.toString()}:${m.student.toString()}`;
                    anonymousIdMap[key] = m.anonymousId;
                }
            }

            // Resolve blind grading state once per distinct exam to prevent Exam lookup N+1 queries
            const exams = await Exam.find({ _id: { $in: examIds } }).lean();
            const examMap = new Map(exams.map(e => [e._id.toString(), e]));

            for (const id of examIds) {
                const exam = examMap.get(id);
                // Apply the same logic as isBlindActive
                if (viewer && (viewer.role === UserRole.PROFESSOR || viewer.role === UserRole.ADMIN)) {
                    blindActiveMap[id] = false;
                    continue;
                }

                const isViewerRoleRecognized = !!(
                    viewer &&
                    viewer.role &&
                    Object.values(UserRole).includes(viewer.role as UserRole)
                );

                if (!isViewerRoleRecognized) {
                    blindActiveMap[id] = true;
                    continue;
                }

                if (!exam || exam.blindGrading) {
                    blindActiveMap[id] = true;
                } else {
                    blindActiveMap[id] = false;
                }
            }
        }

        return await Promise.all(
            scripts.map(s => this.serializeAnswerScript(s, viewer, anonymousIdMap, blindActiveMap))
        );
    }

    /**
     * Serializes a single Grade document/object.
     */
    static async serializeGrade(
        grade: any,
        viewer: ViewerContext,
        anonymousIdMap?: Record<string, string>,
        blindActiveMap?: Record<string, boolean>
    ): Promise<Record<string, any>> {
        if (!grade) return {};

        const gradeObj = typeof grade.toObject === 'function' ? grade.toObject() : grade;

        let examIdStr: string | undefined;
        const scriptObj = gradeObj.answerScript;

        if (scriptObj) {
            if (mongoose.Types.ObjectId.isValid(scriptObj)) {
                const script = await AnswerScript.findById(scriptObj).lean();
                if (script) {
                    examIdStr = script.exam?.toString();
                }
            } else {
                const exam = scriptObj.exam?._id || scriptObj.exam;
                examIdStr = exam?.toString();
            }
        }

        let isBlind: boolean;
        if (blindActiveMap && examIdStr && examIdStr in blindActiveMap) {
            isBlind = blindActiveMap[examIdStr];
        } else {
            isBlind = await this.isBlindActive(examIdStr, viewer);
        }

        if (isBlind) {
            let serializedScript = gradeObj.answerScript;
            if (scriptObj) {
                serializedScript = await this.serializeAnswerScript(scriptObj, viewer, anonymousIdMap, blindActiveMap);
            }

            // Safe allowlist of Grade fields
            return {
                _id: gradeObj._id?.toString() || gradeObj._id,
                answerScript: serializedScript,
                rubric: gradeObj.rubric?.toString() || gradeObj.rubric,
                marksAwarded: gradeObj.marksAwarded,
                totalScore: gradeObj.totalScore,
                feedback: gradeObj.feedback,
                isFinal: gradeObj.isFinal,
                question: gradeObj.question,
                createdAt: gradeObj.createdAt,
                updatedAt: gradeObj.updatedAt
            };
        }

        return gradeObj;
    }

    /**
     * Serializes multiple Grade documents/objects.
     */
    static async serializeGrades(
        grades: any[],
        viewer: ViewerContext
    ): Promise<Record<string, any>[]> {
        if (!grades || grades.length === 0) return [];

        const scriptIds = Array.from(
            new Set(
                grades
                    .map(g => {
                        const gObj = typeof g.toObject === 'function' ? g.toObject() : g;
                        const script = gObj.answerScript;
                        return script && typeof script === 'object' ? script._id : script;
                    })
                    .filter(Boolean)
            )
        );

        const scripts = await AnswerScript.find({ _id: { $in: scriptIds } }).lean();
        const examIds = Array.from(new Set(scripts.map(s => s.exam?.toString()).filter(Boolean)));

        const anonymousIdMap: Record<string, string> = {};
        const blindActiveMap: Record<string, boolean> = {};

        if (examIds.length > 0) {
            const mappings = await StudentMapping.find({ exam: { $in: examIds } }).lean();
            for (const m of mappings) {
                if (m.student && m.exam) {
                    const key = `${m.exam.toString()}:${m.student.toString()}`;
                    anonymousIdMap[key] = m.anonymousId;
                }
            }

            // Resolve blind grading state once per distinct exam to prevent Exam lookup N+1 queries
            const exams = await Exam.find({ _id: { $in: examIds } }).lean();
            const examMap = new Map(exams.map(e => [e._id.toString(), e]));

            for (const id of examIds) {
                const exam = examMap.get(id);
                // Apply the same logic as isBlindActive
                if (viewer && (viewer.role === UserRole.PROFESSOR || viewer.role === UserRole.ADMIN)) {
                    blindActiveMap[id] = false;
                    continue;
                }

                const isViewerRoleRecognized = !!(
                    viewer &&
                    viewer.role &&
                    Object.values(UserRole).includes(viewer.role as UserRole)
                );

                if (!isViewerRoleRecognized) {
                    blindActiveMap[id] = true;
                    continue;
                }

                if (!exam || exam.blindGrading) {
                    blindActiveMap[id] = true;
                } else {
                    blindActiveMap[id] = false;
                }
            }
        }

        return await Promise.all(
            grades.map(g => this.serializeGrade(g, viewer, anonymousIdMap, blindActiveMap))
        );
    }
}

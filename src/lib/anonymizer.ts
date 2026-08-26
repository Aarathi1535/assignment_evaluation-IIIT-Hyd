/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose from 'mongoose';
import Exam from '../models/Exam';
import StudentMapping from '../models/StudentMapping';
import AnswerScript from '../models/AnswerScript';

export interface ViewerContext {
    id: string;
    role: string;
}

export class Anonymizer {
    /**
     * Helper to check if blind grading is active for a given exam and viewer context.
     * Deny-by-default/anonymize-by-default: if exam or viewer info is missing,
     * but the exam is set to blind-grading, we anonymize.
     */
    static async isBlindActive(examId?: string | mongoose.Types.ObjectId, viewer?: ViewerContext): Promise<boolean> {
        if (!examId) return false;
        
        const exam = await Exam.findById(examId).lean();
        if (!exam || !exam.blindGrading) {
            return false;
        }

        // Professor and Admin roles are exempt from anonymization
        if (viewer && (viewer.role === 'PROFESSOR' || viewer.role === 'ADMIN')) {
            return false;
        }

        return true;
    }

    /**
     * Serializes a single AnswerScript document/object.
     */
    static async serializeAnswerScript(
        script: any,
        viewer: ViewerContext,
        anonymousIdMap?: Record<string, string>
    ): Promise<Record<string, any>> {
        if (!script) return {};

        // Convert mongoose documents to plain objects
        const scriptObj = typeof script.toObject === 'function' ? script.toObject() : script;

        const examId = scriptObj.exam?._id || scriptObj.exam;
        const examIdStr = examId?.toString();
        
        const isBlind = await this.isBlindActive(examIdStr, viewer);

        if (isBlind) {
            const studentId = scriptObj.student?._id || scriptObj.student;
            const studentIdStr = studentId?.toString();

            let anonymousId = 'ANONYMOUS';

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

            // Minimal safe allowlist for blind-mode output (omits filePath, filename, batchId, manualIdReason, etc.)
            return {
                _id: scriptObj._id?.toString() || scriptObj._id,
                exam: examIdStr,
                anonymousId,
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
        if (examIds.length > 0) {
            const mappings = await StudentMapping.find({ exam: { $in: examIds } }).lean();
            for (const m of mappings) {
                if (m.student && m.exam) {
                    const key = `${m.exam.toString()}:${m.student.toString()}`;
                    anonymousIdMap[key] = m.anonymousId;
                }
            }
        }

        return await Promise.all(
            scripts.map(s => this.serializeAnswerScript(s, viewer, anonymousIdMap))
        );
    }

    /**
     * Serializes a single Grade document/object.
     */
    static async serializeGrade(
        grade: any,
        viewer: ViewerContext,
        anonymousIdMap?: Record<string, string>
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

        const isBlind = await this.isBlindActive(examIdStr, viewer);

        if (isBlind) {
            let serializedScript = gradeObj.answerScript;
            if (scriptObj && typeof scriptObj === 'object') {
                serializedScript = await this.serializeAnswerScript(scriptObj, viewer, anonymousIdMap);
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
        if (examIds.length > 0) {
            const mappings = await StudentMapping.find({ exam: { $in: examIds } }).lean();
            for (const m of mappings) {
                if (m.student && m.exam) {
                    const key = `${m.exam.toString()}:${m.student.toString()}`;
                    anonymousIdMap[key] = m.anonymousId;
                }
            }
        }

        return await Promise.all(
            grades.map(g => this.serializeGrade(g, viewer, anonymousIdMap))
        );
    }
}

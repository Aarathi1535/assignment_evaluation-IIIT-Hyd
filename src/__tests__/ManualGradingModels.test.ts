import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';

import AnswerScript from '../models/AnswerScript';
import Page from '../models/Page';
import StudentMapping from '../models/StudentMapping';
import Allocation from '../models/Allocation';
import Annotation from '../models/Annotation';
import Grade from '../models/Grade';
import RegradeRequest from '../models/RegradeRequest';
import AuditLog from '../models/AuditLog';

describe('Manual Grading Domain Models Tests', () => {

    describe('AnswerScript Model', () => {
        it('should validate and save a valid AnswerScript', async () => {
            const examId = new mongoose.Types.ObjectId();
            const studentId = new mongoose.Types.ObjectId();

            const answerScriptData = {
                exam: examId,
                student: studentId,
                filePath: '/path/to/script.pdf',
                filename: 'script.pdf'
            };

            const script = new AnswerScript(answerScriptData);
            await expect(script.validate()).resolves.toBeUndefined();

            const saved = await script.save();
            expect(saved._id).toBeDefined();
            expect(saved.isActive).toBe(true);
            expect(saved.createdAt).toBeDefined();

            // Cleanup
            await AnswerScript.findByIdAndDelete(saved._id);
        });

        it('should enforce unique compound index on { exam, student }', async () => {
            const examId = new mongoose.Types.ObjectId();
            const studentId = new mongoose.Types.ObjectId();

            const doc1 = new AnswerScript({
                exam: examId,
                student: studentId,
                filePath: '/path/to/1.pdf',
                filename: '1.pdf'
            });
            await doc1.save();

            const doc2 = new AnswerScript({
                exam: examId,
                student: studentId,
                filePath: '/path/to/2.pdf',
                filename: '2.pdf'
            });

            await expect(doc2.save()).rejects.toThrow();

            // Cleanup
            await AnswerScript.findByIdAndDelete(doc1._id);
        });
    });

    describe('Page Model', () => {
        it('should validate and save a valid Page', async () => {
            const answerScriptId = new mongoose.Types.ObjectId();
            const pageData = {
                answerScript: answerScriptId,
                pageNumber: 1,
                imagePath: '/images/page1.png'
            };

            const page = new Page(pageData);
            await expect(page.validate()).resolves.toBeUndefined();

            const saved = await page.save();
            expect(saved.isActive).toBe(true);

            // Cleanup
            await Page.findByIdAndDelete(saved._id);
        });

        it('should enforce unique pageNumber per AnswerScript', async () => {
            const answerScriptId = new mongoose.Types.ObjectId();

            const page1 = new Page({
                answerScript: answerScriptId,
                pageNumber: 1,
                imagePath: '/images/page1.png'
            });
            await page1.save();

            const page2 = new Page({
                answerScript: answerScriptId,
                pageNumber: 1,
                imagePath: '/images/page1-dup.png'
            });

            await expect(page2.save()).rejects.toThrow();

            // Cleanup
            await Page.findByIdAndDelete(page1._id);
        });
    });

    describe('StudentMapping Model', () => {
        it('should validate and save StudentMapping', async () => {
            const examId = new mongoose.Types.ObjectId();
            const studentId = new mongoose.Types.ObjectId();

            const mapping = new StudentMapping({
                exam: examId,
                student: studentId,
                anonymousId: 'ANON-101'
            });

            await expect(mapping.validate()).resolves.toBeUndefined();
            const saved = await mapping.save();
            expect(saved.isVerified).toBe(false);

            // Cleanup
            await StudentMapping.findByIdAndDelete(saved._id);
        });
    });

    describe('Allocation Model', () => {
        it('should validate Allocation and enforce unique { ta, answerScript }', async () => {
            const examId = new mongoose.Types.ObjectId();
            const taId = new mongoose.Types.ObjectId();
            const answerScriptId = new mongoose.Types.ObjectId();
            const allocatedById = new mongoose.Types.ObjectId();

            const allocation = new Allocation({
                exam: examId,
                ta: taId,
                answerScript: answerScriptId,
                allocatedBy: allocatedById
            });

            await expect(allocation.validate()).resolves.toBeUndefined();
            const saved = await allocation.save();
            expect(saved.status).toBe('PENDING');

            const allocation2 = new Allocation({
                exam: examId,
                ta: taId,
                answerScript: answerScriptId,
                allocatedBy: allocatedById
            });
            await expect(allocation2.save()).rejects.toThrow();

            // Cleanup
            await Allocation.findByIdAndDelete(saved._id);
        });
    });

    describe('Annotation Model', () => {
        it('should validate and save Annotation with coordinates', async () => {
            const pageId = new mongoose.Types.ObjectId();
            const annotatedById = new mongoose.Types.ObjectId();

            const annotation = new Annotation({
                page: pageId,
                annotatedBy: annotatedById,
                comment: 'Incorrect formula used.',
                position: {
                    x: 100,
                    y: 200,
                    width: 50,
                    height: 20
                }
            });

            await expect(annotation.validate()).resolves.toBeUndefined();
            const saved = await annotation.save();
            expect(saved.position?.x).toBe(100);

            // Cleanup
            await Annotation.findByIdAndDelete(saved._id);
        });
    });

    describe('Grade Model', () => {
        it('should validate and save Grade details', async () => {
            const answerScriptId = new mongoose.Types.ObjectId();
            const rubricId = new mongoose.Types.ObjectId();
            const gradedById = new mongoose.Types.ObjectId();

            const grade = new Grade({
                answerScript: answerScriptId,
                rubric: rubricId,
                gradedBy: gradedById,
                marksAwarded: [
                    { criterionName: 'Correctness', score: 8, feedback: 'Well explained.' },
                    { criterionName: 'Presentation', score: 2 }
                ],
                totalScore: 10
            });

            await expect(grade.validate()).resolves.toBeUndefined();
            const saved = await grade.save();
            expect(saved.isFinal).toBe(false);

            // Cleanup
            await Grade.findByIdAndDelete(saved._id);
        });
    });

    describe('RegradeRequest Model', () => {
        it('should validate and save a RegradeRequest', async () => {
            const answerScriptId = new mongoose.Types.ObjectId();
            const studentId = new mongoose.Types.ObjectId();

            const request = new RegradeRequest({
                answerScript: answerScriptId,
                student: studentId,
                reason: 'I believe Question 2 was graded too harshly.'
            });

            await expect(request.validate()).resolves.toBeUndefined();
            const saved = await request.save();
            expect(saved.status).toBe('PENDING');

            // Cleanup
            await RegradeRequest.findByIdAndDelete(saved._id);
        });
    });

    describe('AuditLog Model', () => {
        it('should validate and save AuditLog entries', async () => {
            const userId = new mongoose.Types.ObjectId();
            const entityId = new mongoose.Types.ObjectId();

            const log = new AuditLog({
                user: userId,
                action: 'GRADE_PUBLISHED',
                entityId: entityId,
                entityType: 'Grade',
                details: { ip: '127.0.0.1', changes: { isFinal: true } }
            });

            await expect(log.validate()).resolves.toBeUndefined();
            const saved = await log.save();
            expect(saved.createdAt).toBeDefined();

            // Cleanup
            await AuditLog.findByIdAndDelete(saved._id);
        });
    });
});

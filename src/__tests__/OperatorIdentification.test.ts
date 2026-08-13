/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import StudentMapping from '../models/StudentMapping';
import User, { UserRole } from '../models/User';
import Exam, { ExamStatus } from '../models/Exam';
import Course from '../models/Course';
import AnswerScript from '../models/AnswerScript';
import IngestionPage from '../models/IngestionPage';
import AuditLog from '../models/AuditLog';
import Batch, { BatchStatus } from '../models/Batch';
import defaultIngestionWorker from '../services/IngestionWorker';
import { NextRequest } from 'next/server';
import { POST as identifyRoute } from '../app/api/answerscripts/[id]/identify/route';
import { GET as getStudentsRoute } from '../app/api/exams/[id]/students/route';

let mockSessionUser: any = null;

// Mock next-auth to allow dynamic control of session users in RBAC testing
vi.mock('next-auth', async (importOriginal) => {
    const original = await importOriginal<typeof import('next-auth')>();
    return {
        ...original,
        getServerSession: vi.fn().mockImplementation(() => {
            if (!mockSessionUser) return Promise.resolve(null);
            return Promise.resolve({ user: mockSessionUser });
        }),
    };
});

describe('GitHub Issue #41 — Operator-Based AnswerScript Identification', () => {
    let profOwner: any;
    let profOther: any;
    let studentInRoster: any;
    let studentNotInRoster: any;
    let course1: any;
    let exam1: any;
    let scriptToIdentify: any;
    let ingestionPageCover: any;
    let ingestionPageContent: any;

    beforeAll(async () => {
        await StudentMapping.init();
        await User.init();
        await Exam.init();
        await Course.init();
        await AnswerScript.init();
        await IngestionPage.init();
        await Batch.init();
    });

    beforeEach(async () => {
        defaultIngestionWorker.stop();
        mockSessionUser = null;

        // Create professors
        profOwner = await User.create({
            name: 'Prof Owner',
            email: `prof-owner-${Date.now()}@university.edu`,
            password: 'hashed-password',
            role: UserRole.PROFESSOR,
            isActive: true
        });

        profOther = await User.create({
            name: 'Prof Other',
            email: `prof-other-${Date.now()}@university.edu`,
            password: 'hashed-password',
            role: UserRole.PROFESSOR,
            isActive: true
        });

        // Create students
        studentInRoster = await User.create({
            name: 'Robert Roster',
            email: `robert-${Date.now()}@university.edu`,
            password: 'hashed-password',
            role: UserRole.STUDENT,
            isActive: true
        });

        studentNotInRoster = await User.create({
            name: 'Steve Stranger',
            email: `steve-${Date.now()}@university.edu`,
            password: 'hashed-password',
            role: UserRole.STUDENT,
            isActive: true
        });

        // Create Course
        course1 = await Course.create({
            courseCode: `CS-501-${Date.now()}`,
            courseName: 'Cloud Computing',
            semester: 1,
            academicYear: '2026-2027',
            professor: profOwner._id,
            enrolledStudents: [studentInRoster._id],
            isActive: true
        });

        // Create Exam
        exam1 = await Exam.create({
            title: 'Midterm Cloud',
            course: course1._id,
            createdBy: profOwner._id,
            examDate: new Date(),
            totalMarks: 100,
            status: ExamStatus.SCHEDULED,
            numberOfQuestions: 3,
            enrolledStudents: [studentInRoster._id],
            isActive: true
        });

        // Create Student Mapping for Roster Student
        await StudentMapping.create({
            exam: exam1._id,
            student: studentInRoster._id,
            anonymousId: 'ANON-ROSTER-01',
            rollNumber: 'CS-ROLL-01'
        });

        // Create AnswerScript requiring manual identification
        scriptToIdentify = await AnswerScript.create({
            exam: exam1._id,
            student: null,
            filePath: '/uploads/batch-01/script-01.pdf',
            filename: 'script-01.pdf',
            batchId: 'batch-01',
            fileIndex: 0,
            startPageNumber: 1,
            endPageNumber: 3,
            pageCount: 3,
            candidateStudentId: null,
            identificationSource: null,
            identificationStatus: 'UNIDENTIFIED',
            needsManualId: true,
            manualIdReason: 'NO_CODE_FOUND',
            isActive: true
        });

        // Create associated IngestionPage records
        ingestionPageCover = await IngestionPage.create({
            batchId: 'batch-01',
            job: new mongoose.Types.ObjectId(),
            fileId: 'file-01',
            storageKey: 'key-01',
            fileIndex: 0,
            pageNumber: 1,
            isCoverPage: true
        });

        ingestionPageContent = await IngestionPage.create({
            batchId: 'batch-01',
            job: new mongoose.Types.ObjectId(),
            fileId: 'file-01',
            storageKey: 'key-02',
            fileIndex: 0,
            pageNumber: 2,
            isCoverPage: false
        });

        // Create Batch document
        await Batch.create({
            batchId: 'batch-01',
            exam: exam1._id,
            uploadedBy: profOwner._id,
            files: [
                {
                    fileIndex: 0,
                    fileId: 'file-01',
                    originalFilename: 'script-01.pdf',
                    storageKey: 'key-01',
                    pageCount: 3,
                    size: 100,
                    mimeType: 'application/pdf',
                    fileType: 'pdf'
                },
                {
                    fileIndex: 1,
                    fileId: 'file-other',
                    originalFilename: 'script-other.pdf',
                    storageKey: 'key-other',
                    pageCount: 3,
                    size: 100,
                    mimeType: 'application/pdf',
                    fileType: 'pdf'
                },
                {
                    fileIndex: 2,
                    fileId: 'file-corr',
                    originalFilename: 'corr.pdf',
                    storageKey: 'key-corr',
                    pageCount: 3,
                    size: 100,
                    mimeType: 'application/pdf',
                    fileType: 'pdf'
                }
            ],
            totalFiles: 3,
            totalSize: 300,
            totalPageCount: 9,
            status: BatchStatus.PROCESSING,
            isActive: true
        });
    });

    describe('1. Exam Roster Lookup & Search (Name, Email, RollNumber)', () => {
        it('allows lookup by rollNumber, name, and email', async () => {
            mockSessionUser = { id: profOwner._id.toString(), email: profOwner.email, role: 'PROFESSOR' };

            // Look up by Roll Number
            const reqRoll = new NextRequest(`http://localhost:3000/api/exams/${exam1._id}/students?query=CS-ROLL-01`);
            const resRoll = await getStudentsRoute(reqRoll, { params: Promise.resolve({ id: exam1._id.toString() }) });
            const jsonRoll = await resRoll.json();
            expect(resRoll.status).toBe(200);
            expect(jsonRoll.data.length).toBe(1);
            expect(jsonRoll.data[0].name).toBe('Robert Roster');

            // Look up by Name substring
            const reqName = new NextRequest(`http://localhost:3000/api/exams/${exam1._id}/students?q=obert`);
            const resName = await getStudentsRoute(reqName, { params: Promise.resolve({ id: exam1._id.toString() }) });
            const jsonName = await resName.json();
            expect(resName.status).toBe(200);
            expect(jsonName.data.length).toBe(1);
            expect(jsonName.data[0].rollNumber).toBe('CS-ROLL-01');

            // Look up by Email substring
            const reqEmail = new NextRequest(`http://localhost:3000/api/exams/${exam1._id}/students?query=robert`);
            const resEmail = await getStudentsRoute(reqEmail, { params: Promise.resolve({ id: exam1._id.toString() }) });
            const jsonEmail = await resEmail.json();
            expect(resEmail.status).toBe(200);
            expect(jsonEmail.data.length).toBe(1);
        });

        it('reuses normalizeRollNumber behavior in the search lookup', async () => {
            mockSessionUser = { id: profOwner._id.toString(), email: profOwner.email, role: 'PROFESSOR' };

            // Space and casing insensitive roll number search
            const reqRoll = new NextRequest(`http://localhost:3000/api/exams/${exam1._id}/students?query=   cs-roll-01   `);
            const resRoll = await getStudentsRoute(reqRoll, { params: Promise.resolve({ id: exam1._id.toString() }) });
            const jsonRoll = await resRoll.json();
            expect(resRoll.status).toBe(200);
            expect(jsonRoll.data.length).toBe(1);
            expect(jsonRoll.data[0].name).toBe('Robert Roster');
        });
    });

    describe('2. Operator Manual Identification Endpoint & Authorization', () => {
        it('requires EDIT_EXAM permission (fails for role without it, e.g. STUDENT)', async () => {
            mockSessionUser = { id: studentInRoster._id.toString(), email: studentInRoster.email, role: 'STUDENT' };

            const req = new NextRequest(`http://localhost:3000/api/answerscripts/${scriptToIdentify._id}/identify`, {
                method: 'POST',
                body: JSON.stringify({ studentId: studentInRoster._id.toString() })
            });

            const res = await identifyRoute(req, { params: Promise.resolve({ id: scriptToIdentify._id.toString() }) });
            expect(res.status).toBe(403);

            // Script should remain unchanged
            const scriptAfter = await AnswerScript.findById(scriptToIdentify._id);
            expect(scriptAfter?.student).toBeNull();
            expect(scriptAfter?.needsManualId).toBe(true);
        });

        it('enforces owner-scoped exam access (fails when non-owner professor tries to identify)', async () => {
            mockSessionUser = { id: profOther._id.toString(), email: profOther.email, role: 'PROFESSOR' };

            const req = new NextRequest(`http://localhost:3000/api/answerscripts/${scriptToIdentify._id}/identify`, {
                method: 'POST',
                body: JSON.stringify({ studentId: studentInRoster._id.toString() })
            });

            const res = await identifyRoute(req, { params: Promise.resolve({ id: scriptToIdentify._id.toString() }) });
            expect(res.status).toBe(404);

            // Script should remain unchanged
            const scriptAfter = await AnswerScript.findById(scriptToIdentify._id);
            expect(scriptAfter?.student).toBeNull();
            expect(scriptAfter?.needsManualId).toBe(true);
        });

        it('allows authorized exam owner to manually identify the script', async () => {
            mockSessionUser = { id: profOwner._id.toString(), email: profOwner.email, role: 'PROFESSOR' };

            const req = new NextRequest(`http://localhost:3000/api/answerscripts/${scriptToIdentify._id}/identify`, {
                method: 'POST',
                body: JSON.stringify({ studentId: studentInRoster._id.toString() })
            });

            const res = await identifyRoute(req, { params: Promise.resolve({ id: scriptToIdentify._id.toString() }) });
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.success).toBe(true);

            // Verify AnswerScript fields updated correctly
            const scriptAfter = await AnswerScript.findById(scriptToIdentify._id);
            expect(scriptAfter?.student?.toString()).toBe(studentInRoster._id.toString());
            expect(scriptAfter?.candidateStudentId).toBe(studentInRoster._id.toString());
            expect(scriptAfter?.identificationSource).toBe('OPERATOR');
            expect(scriptAfter?.identificationStatus).toBe('IDENTIFIED');
            expect(scriptAfter?.needsManualId).toBe(false);
            expect(scriptAfter?.manualIdReason).toBeNull();

            // Verify IngestionPages are completely unmodified
            const page1 = await IngestionPage.findById(ingestionPageCover._id);
            const page2 = await IngestionPage.findById(ingestionPageContent._id);
            expect(page1).not.toBeNull();
            expect(page2).not.toBeNull();
            expect(page1?.storageKey).toBe('key-01');
            expect(page2?.storageKey).toBe('key-02');
        });
    });

    describe('3. Student Validation Rules', () => {
        it('rejects student user who does not belong to the exam roster', async () => {
            mockSessionUser = { id: profOwner._id.toString(), email: profOwner.email, role: 'PROFESSOR' };

            const req = new NextRequest(`http://localhost:3000/api/answerscripts/${scriptToIdentify._id}/identify`, {
                method: 'POST',
                body: JSON.stringify({ studentId: studentNotInRoster._id.toString() })
            });

            const res = await identifyRoute(req, { params: Promise.resolve({ id: scriptToIdentify._id.toString() }) });
            const json = await res.json();

            expect(res.status).toBe(400);
            expect(json.success).toBe(false);
            expect(json.message).toContain('not enrolled in this exam roster');

            // AnswerScript and IngestionPages must be preserved
            const scriptAfter = await AnswerScript.findById(scriptToIdentify._id);
            expect(scriptAfter?.student).toBeNull();
            expect(scriptAfter?.needsManualId).toBe(true);

            const countPages = await IngestionPage.countDocuments({ batchId: 'batch-01' });
            expect(countPages).toBe(2);
        });

        it('rejects invalid or missing studentId parameter', async () => {
            mockSessionUser = { id: profOwner._id.toString(), email: profOwner.email, role: 'PROFESSOR' };

            // Test missing studentId
            const reqMissing = new NextRequest(`http://localhost:3000/api/answerscripts/${scriptToIdentify._id}/identify`, {
                method: 'POST',
                body: JSON.stringify({})
            });
            const resMissing = await identifyRoute(reqMissing, { params: Promise.resolve({ id: scriptToIdentify._id.toString() }) });
            expect(resMissing.status).toBe(400);

            // Test invalid studentId format
            const reqInvalid = new NextRequest(`http://localhost:3000/api/answerscripts/${scriptToIdentify._id}/identify`, {
                method: 'POST',
                body: JSON.stringify({ studentId: 'not-an-object-id' })
            });
            const resInvalid = await identifyRoute(reqInvalid, { params: Promise.resolve({ id: scriptToIdentify._id.toString() }) });
            expect(resInvalid.status).toBe(400);
        });
    });

    describe('4. Duplicate (Exam, Student) Collision Handling', () => {
        let otherScript: any;

        beforeEach(async () => {
            // Already identified script for studentInRoster
            otherScript = await AnswerScript.create({
                exam: exam1._id,
                student: studentInRoster._id,
                filePath: '/uploads/batch-01/script-other.pdf',
                filename: 'script-other.pdf',
                batchId: 'batch-01',
                fileIndex: 1,
                startPageNumber: 4,
                endPageNumber: 6,
                pageCount: 3,
                candidateStudentId: studentInRoster._id.toString(),
                identificationSource: 'QR',
                identificationStatus: 'IDENTIFIED',
                needsManualId: false,
                isActive: true
            });
        });

        it('returns a controlled conflict when attempting to identify another script to the same student', async () => {
            mockSessionUser = { id: profOwner._id.toString(), email: profOwner.email, role: 'PROFESSOR' };

            const req = new NextRequest(`http://localhost:3000/api/answerscripts/${scriptToIdentify._id}/identify`, {
                method: 'POST',
                body: JSON.stringify({ studentId: studentInRoster._id.toString() })
            });

            const res = await identifyRoute(req, { params: Promise.resolve({ id: scriptToIdentify._id.toString() }) });
            const json = await res.json();

            expect(res.status).toBe(409);
            expect(json.success).toBe(false);
            expect(json.message).toContain('already identified');

            // Verify original script has not been modified or corrupted
            const scriptAfter = await AnswerScript.findById(scriptToIdentify._id);
            expect(scriptAfter?.student).toBeNull();
            expect(scriptAfter?.needsManualId).toBe(true);

            // Verify the other identified script has NOT been overwritten or affected
            const otherAfter = await AnswerScript.findById(otherScript._id);
            expect(otherAfter?.student?.toString()).toBe(studentInRoster._id.toString());
            expect(otherAfter?.identificationStatus).toBe('IDENTIFIED');
        });
    });

    describe('5. Audited Correction & Automatic Overwrite Prevention (GitHub Issue #42)', () => {
        let studentA: any;
        let studentB: any;
        let scriptForCorr: any;

        beforeEach(async () => {
            // Create additional student B
            studentA = studentInRoster;
            studentB = await User.create({
                name: 'Student B',
                email: `student-b-${Date.now()}@university.edu`,
                password: 'password',
                role: UserRole.STUDENT,
                isActive: true
            });

            // Add student B to course and exam roster mappings
            await Course.updateOne({ _id: course1._id }, { $addToSet: { enrolledStudents: studentB._id } });
            await StudentMapping.create({
                exam: exam1._id,
                student: studentB._id,
                anonymousId: 'ANON-ROSTER-B',
                rollNumber: 'CS-ROLL-02'
            });

            // Create already identified script for Student A
            scriptForCorr = await AnswerScript.create({
                exam: exam1._id,
                student: studentA._id,
                filePath: '/uploads/batch-01/corr.pdf',
                filename: 'corr.pdf',
                batchId: 'batch-01',
                fileIndex: 2,
                startPageNumber: 7,
                endPageNumber: 9,
                pageCount: 3,
                candidateStudentId: studentA._id.toString(),
                identificationSource: 'QR',
                identificationStatus: 'IDENTIFIED',
                needsManualId: false,
                isActive: true
            });
        });

        it('creates a SUCCESS audit log on first manual identification', async () => {
            mockSessionUser = { id: profOwner._id.toString(), email: profOwner.email, role: 'PROFESSOR' };

            // Find count of audits before
            const countBefore = await AuditLog.countDocuments({ action: 'ANSWERSCRIPT_IDENTIFIED' });

            const req = new NextRequest(`http://localhost:3000/api/answerscripts/${scriptToIdentify._id}/identify`, {
                method: 'POST',
                body: JSON.stringify({ studentId: studentB._id.toString() })
            });

            const res = await identifyRoute(req, { params: Promise.resolve({ id: scriptToIdentify._id.toString() }) });
            expect(res.status).toBe(200);

            const countAfter = await AuditLog.countDocuments({ action: 'ANSWERSCRIPT_IDENTIFIED' });
            expect(countAfter).toBe(countBefore + 1);

            const audit = await AuditLog.findOne({ action: 'ANSWERSCRIPT_IDENTIFIED', entityId: scriptToIdentify._id });
            expect(audit).not.toBeNull();
            expect(audit?.outcome).toBe('SUCCESS');
            expect(audit?.user.toString()).toBe(profOwner._id.toString());
            expect(audit?.details?.previousStudentId).toBeNull();
            expect(audit?.details?.newStudentId).toBe(studentB._id.toString());
        });

        it('allows human correction (A -> B), updates fields, and logs audit transition containing old & new students', async () => {
            mockSessionUser = { id: profOwner._id.toString(), email: profOwner.email, role: 'PROFESSOR' };

            const req = new NextRequest(`http://localhost:3000/api/answerscripts/${scriptForCorr._id}/identify`, {
                method: 'POST',
                body: JSON.stringify({ studentId: studentB._id.toString() })
            });

            const res = await identifyRoute(req, { params: Promise.resolve({ id: scriptForCorr._id.toString() }) });
            expect(res.status).toBe(200);

            // Verify script update
            const updated = await AnswerScript.findById(scriptForCorr._id);
            expect(updated?.student?.toString()).toBe(studentB._id.toString());
            expect(updated?.candidateStudentId).toBe(studentB._id.toString());
            expect(updated?.identificationSource).toBe('OPERATOR');
            expect(updated?.identificationStatus).toBe('IDENTIFIED');

            // Verify audit log tracks correction details
            const audit = await AuditLog.findOne({
                action: 'ANSWERSCRIPT_IDENTIFIED',
                entityId: scriptForCorr._id,
                'details.previousStudentId': studentA._id.toString(),
                'details.newStudentId': studentB._id.toString()
            });
            expect(audit).not.toBeNull();
            expect(audit?.user.toString()).toBe(profOwner._id.toString());
        });

        it('automatic assembly does never silently overwrite an already identified AnswerScript', async () => {
            // Suppose scriptForCorr was identified by operator as Student A
            // We run background assembly simulation where cover sheet QR scans to Student B
            const defaultStudentRosterMappingService = (await import('../services/StudentRosterMappingService')).default;

            // Create associated IngestionPages for corr script to simulate scanner background ingestion
            await IngestionPage.create({
                batchId: 'batch-01',
                job: new mongoose.Types.ObjectId(),
                fileId: 'file-corr',
                storageKey: 'key-corr-cover',
                fileIndex: 2,
                pageNumber: 7,
                isCoverPage: true,
                candidateStudentId: studentB._id.toString(),
                decodeOutcome: 'found'
            });

            await IngestionPage.create({
                batchId: 'batch-01',
                job: new mongoose.Types.ObjectId(),
                fileId: 'file-corr',
                storageKey: 'key-corr-content',
                fileIndex: 2,
                pageNumber: 8,
                isCoverPage: false
            });

            const results = await defaultStudentRosterMappingService.assembleAndMapAnswerScripts(
                'batch-01',
                { actingUserId: profOwner._id.toString(), actingUserRole: 'PROFESSOR' }
            );

            expect(results.length).toBe(2); // scriptToIdentify (fileIndex 0) and scriptForCorr (fileIndex 2)

            // Verify student remains Student A (original assignment preserved, B not silently overwritten)
            const scriptInDb = await AnswerScript.findById(scriptForCorr._id);
            expect(scriptInDb?.student?.toString()).toBe(studentA._id.toString());
            // Candidate student ID from scan is preserved for review/history
            expect(scriptInDb?.candidateStudentId).toBe(studentB._id.toString());
        });

        it('failed correction leaves the target script and ingestion pages completely unchanged without a successful audit log', async () => {
            mockSessionUser = { id: profOwner._id.toString(), email: profOwner.email, role: 'PROFESSOR' };

            const req = new NextRequest(`http://localhost:3000/api/answerscripts/${scriptForCorr._id}/identify`, {
                method: 'POST',
                body: JSON.stringify({ studentId: 'invalid-id' })
            });

            const countBefore = await AuditLog.countDocuments({ action: 'ANSWERSCRIPT_IDENTIFIED', outcome: 'SUCCESS' });

            const res = await identifyRoute(req, { params: Promise.resolve({ id: scriptForCorr._id.toString() }) });
            expect(res.status).toBe(400);

            // Script should be unchanged
            const scriptAfter = await AnswerScript.findById(scriptForCorr._id);
            expect(scriptAfter?.student?.toString()).toBe(studentA._id.toString());

            // No new success audit log
            const countAfter = await AuditLog.countDocuments({ action: 'ANSWERSCRIPT_IDENTIFIED', outcome: 'SUCCESS' });
            expect(countAfter).toBe(countBefore);
        });
    });
});

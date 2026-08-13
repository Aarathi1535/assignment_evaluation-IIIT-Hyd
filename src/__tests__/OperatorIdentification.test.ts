/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import StudentMapping from '../models/StudentMapping';
import User, { UserRole } from '../models/User';
import Exam, { ExamStatus } from '../models/Exam';
import Course from '../models/Course';
import AnswerScript from '../models/AnswerScript';
import IngestionPage from '../models/IngestionPage';
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
    });

    beforeEach(async () => {
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
});

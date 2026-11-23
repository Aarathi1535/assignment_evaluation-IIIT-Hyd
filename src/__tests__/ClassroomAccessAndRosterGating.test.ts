import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from '../models/User';
import ClassroomSession from '../models/ClassroomSession';
import { UserRole } from '../constants/permissions';
import classroomSessionService from '../services/ClassroomSessionService';

let mockSessionUser: any = null;

vi.mock('next-auth', () => {
    return {
        getServerSession: vi.fn(() => {
            if (!mockSessionUser) return Promise.resolve(null);
            return Promise.resolve({ user: mockSessionUser });
        }),
    };
});

describe('Classroom Access by Request Only & Student Roster Gating', () => {
    let registerPOST: any;
    let loginPOST: any;
    let grantAccessPATCH: any;
    let prof: any;
    let admin: any;

    beforeAll(async () => {
        registerPOST = (await import('../app/api/classroom/auth/register/route')).POST;
        loginPOST = (await import('../app/api/classroom/auth/login/route')).POST;
        grantAccessPATCH = (await import('../app/api/admin/users/[id]/classroom-access/route')).PATCH;
    });

    beforeEach(async () => {
        await User.deleteMany({});
        await ClassroomSession.deleteMany({});

        const hashedPassword = await bcrypt.hash('Password@123', 10);

        admin = await User.create({
            name: 'Admin User',
            email: 'admin@iiit.ac.in',
            password: hashedPassword,
            role: UserRole.ADMIN,
            isActive: true,
        });

        prof = await User.create({
            name: 'Prof Classroom',
            email: 'prof.classroom@iiit.ac.in',
            password: hashedPassword,
            role: UserRole.PROFESSOR,
            isActive: true,
            classroomAccess: false,
            classroomRequestStatus: 'NONE',
        });
    });

    it('denies public self-registration with 403 Forbidden', async () => {
        const req = new NextRequest('http://localhost:3000/api/classroom/auth/register', {
            method: 'POST',
            body: JSON.stringify({
                name: 'Stranger',
                email: 'stranger@example.com',
                password: 'Password@123',
            }),
        });

        const res = await registerPOST(req);
        const body = await res.json();

        expect(res.status).toBe(403);
        expect(body.success).toBe(false);
        expect(body.message).toContain('Self-registration is disabled');
    });

    it('denies classroom login for professor without admin-granted classroomAccess', async () => {
        const req = new NextRequest('http://localhost:3000/api/classroom/auth/login', {
            method: 'POST',
            body: JSON.stringify({
                email: prof.email,
                password: 'Password@123',
            }),
        });

        const res = await loginPOST(req);
        const body = await res.json();

        expect(res.status).toBe(403);
        expect(body.success).toBe(false);
        expect(body.code).toBe('CLASSROOM_ACCESS_DENIED');
    });

    it('allows admin to grant classroom access to professor', async () => {
        mockSessionUser = {
            id: admin._id.toString(),
            email: admin.email,
            role: UserRole.ADMIN,
        };

        const req = new NextRequest(`http://localhost:3000/api/admin/users/${prof._id}/classroom-access`, {
            method: 'PATCH',
            body: JSON.stringify({
                granted: true,
            }),
        });

        const res = await grantAccessPATCH(req, {
            params: Promise.resolve({ id: prof._id.toString() }),
        });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.data.classroomAccess).toBe(true);

        const updatedProf = await User.findById(prof._id);
        expect(updatedProf!.classroomAccess).toBe(true);
    });

    it('allows professor with classroomAccess to login successfully', async () => {
        prof.classroomAccess = true;
        await prof.save();

        const req = new NextRequest('http://localhost:3000/api/classroom/auth/login', {
            method: 'POST',
            body: JSON.stringify({
                email: prof.email,
                password: 'Password@123',
            }),
        });

        const res = await loginPOST(req);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.data.user.role).toBe('PROFESSOR');
        expect(body.data.token).toBeDefined();
    });

    it('enforces student roster gating on classroom session join', async () => {
        prof.classroomAccess = true;
        await prof.save();

        // Professor creates session with restricted student roster
        const { session } = await classroomSessionService.createSessionAndActivity({
            title: 'Live Trees Quiz',
            questionPrompt: 'Construct AVL tree after inserting 10, 20, 30.',
            timeLimit: 120,
            allowedStudents: ['student1@iiit.ac.in', '2023001', 'Student Two'],
        }, {
            actingUserId: prof._id.toString(),
            actingUserRole: 'PROFESSOR',
        });

        expect(session.restrictedRoster).toBe(true);
        expect(session.allowedStudents).toContain('student1@iiit.ac.in');
        expect(session.allowedStudents).toContain('2023001');

        // Student on the allowed list joining by email can join
        const joinSuccess = await classroomSessionService.joinSession(
            session.joinCode,
            'student1@iiit.ac.in'
        );
        expect(joinSuccess.participant).toBeDefined();
        expect(joinSuccess.session.joinCode).toBe(session.joinCode);

        // Student on the allowed list joining by roll number can join
        const joinRollSuccess = await classroomSessionService.joinSession(
            session.joinCode,
            '2023001'
        );
        expect(joinRollSuccess.participant).toBeDefined();

        // Student on the allowed list joining by name can join
        const joinNameSuccess = await classroomSessionService.joinSession(
            session.joinCode,
            'Student Two'
        );
        expect(joinNameSuccess.participant).toBeDefined();

        // Student NOT on the roster is rejected with 403 Forbidden
        await expect(
            classroomSessionService.joinSession(
                session.joinCode,
                'Intruder Student',
                'intruder@external.com'
            )
        ).rejects.toThrow(/You are not in the enrolled student list/);
    });
});

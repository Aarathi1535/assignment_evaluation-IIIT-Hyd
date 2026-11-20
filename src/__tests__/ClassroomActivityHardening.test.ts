import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import classroomSessionService from '../services/ClassroomSessionService';
import classroomStorageService from '../services/ClassroomStorageService';
import ClassroomSession from '../models/ClassroomSession';
import ClassroomQuestion from '../models/ClassroomQuestion';
import ClassroomParticipant from '../models/ClassroomParticipant';
import ClassroomSubmission from '../models/ClassroomSubmission';

describe('Classroom Activity Hardening & Security Suite', () => {
    let prof1Id: string;
    let prof2Id: string;
    let studentId: string;

    // Standard valid 1x1 PNG image buffer with valid magic bytes
    const validPngBuffer = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
        0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
        0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
        0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
        0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
        0x42, 0x60, 0x82,
        // Pad to > 100 bytes to satisfy minimum size requirement
        ...new Array(40).fill(0x00)
    ]);

    // Standard valid JPEG buffer with valid magic bytes (FF D8 FF)
    const validJpegBuffer = Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
        0x01, 0x01, 0x00, 0x60, 0x00, 0x60, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
        ...new Array(80).fill(0x01),
        0xff, 0xd9
    ]);

    beforeEach(async () => {
        prof1Id = new mongoose.Types.ObjectId().toString();
        prof2Id = new mongoose.Types.ObjectId().toString();
        studentId = new mongoose.Types.ObjectId().toString();

        await ClassroomSubmission.deleteMany({});
        await ClassroomParticipant.deleteMany({});
        await ClassroomQuestion.deleteMany({});
        await ClassroomSession.deleteMany({});
    });

    describe('1. Professor Authorization & Ownership Checks', () => {
        it('rejects non-professor role from creating classroom sessions', async () => {
            await expect(
                classroomSessionService.createSessionAndActivity(
                    {
                        title: 'Operating Systems Quiz',
                        questionPrompt: 'Explain Semaphore vs Mutex'
                    },
                    { actingUserId: studentId, actingUserRole: 'STUDENT' }
                )
            ).rejects.toThrow(/Forbidden: Only professors can create classroom sessions/);
        });

        it('enforces ownership: prevents Professor 2 from closing Professor 1 session', async () => {
            const { session } = await classroomSessionService.createSessionAndActivity(
                {
                    title: 'DSA Session',
                    questionPrompt: 'Explain AVL tree balancing',
                    timeLimit: 120
                },
                { actingUserId: prof1Id, actingUserRole: 'PROFESSOR' }
            );

            // Professor 2 tries to close Professor 1's session
            await expect(
                classroomSessionService.closeSubmissions(
                    session.joinCode,
                    { actingUserId: prof2Id, actingUserRole: 'PROFESSOR' }
                )
            ).rejects.toThrow(/Forbidden: You do not own this classroom session/);

            // Professor 1 (owner) can close it successfully
            const closed = await classroomSessionService.closeSubmissions(
                session.joinCode,
                { actingUserId: prof1Id, actingUserRole: 'PROFESSOR' }
            );
            expect(closed.status).toBe('CLOSED');
        });

        it('enforces ownership: prevents Professor 2 from extending timer on Professor 1 session', async () => {
            const { session } = await classroomSessionService.createSessionAndActivity(
                {
                    title: 'Algorithms',
                    questionPrompt: 'Dijkstra shortest path',
                    timeLimit: 60
                },
                { actingUserId: prof1Id, actingUserRole: 'PROFESSOR' }
            );

            await expect(
                classroomSessionService.extendTimer(
                    session.joinCode,
                    60,
                    { actingUserId: prof2Id, actingUserRole: 'PROFESSOR' }
                )
            ).rejects.toThrow(/Forbidden: You do not own this classroom session/);

            // Owner can extend
            const extended = await classroomSessionService.extendTimer(
                session.joinCode,
                60,
                { actingUserId: prof1Id, actingUserRole: 'PROFESSOR' }
            );
            expect(extended.status).toBe('ACTIVE');
        });

        it('enforces ownership: prevents Professor 2 from reviewing submissions in Professor 1 session', async () => {
            const { session } = await classroomSessionService.createSessionAndActivity(
                {
                    title: 'Database Systems',
                    questionPrompt: 'Define 3NF normalization'
                },
                { actingUserId: prof1Id, actingUserRole: 'PROFESSOR' }
            );

            const joinResult = await classroomSessionService.joinSession(session.joinCode, 'Rahul Verma');
            const submission = await classroomSessionService.submitHandwrittenAnswer({
                sessionCode: session.joinCode,
                participantId: joinResult.participant.id,
                studentName: joinResult.participant.name,
                fileBuffer: validJpegBuffer,
                mimeType: 'image/jpeg'
            });

            // Professor 2 tries to review
            await expect(
                classroomSessionService.reviewSubmission(
                    submission._id.toString(),
                    true,
                    'Good',
                    { actingUserId: prof2Id, actingUserRole: 'PROFESSOR' }
                )
            ).rejects.toThrow(/Forbidden: You do not own the session for this submission/);

            // Owner reviews
            const reviewed = await classroomSessionService.reviewSubmission(
                submission._id.toString(),
                true,
                'Excellent explanation',
                { actingUserId: prof1Id, actingUserRole: 'PROFESSOR' }
            );
            expect(reviewed.isCorrect).toBe(true);
            expect(reviewed.status).toBe('REVIEWED');
        });

        it('enforces ownership: prevents Professor 2 from publishing results of Professor 1 session', async () => {
            const { session } = await classroomSessionService.createSessionAndActivity(
                {
                    title: 'Networks',
                    questionPrompt: 'Explain TCP 3-way handshake',
                    referenceAnswer: 'SYN, SYN-ACK, ACK'
                },
                { actingUserId: prof1Id, actingUserRole: 'PROFESSOR' }
            );

            await expect(
                classroomSessionService.publishResults(
                    session.joinCode,
                    { actingUserId: prof2Id, actingUserRole: 'PROFESSOR' }
                )
            ).rejects.toThrow(/Forbidden: You do not own this classroom session/);

            // Owner publishes
            const published = await classroomSessionService.publishResults(
                session.joinCode,
                { actingUserId: prof1Id, actingUserRole: 'PROFESSOR' }
            );
            expect(published.referenceAnswer).toBe('SYN, SYN-ACK, ACK');
        });

        it('enforces ownership: prevents Professor 2 from listing submissions of Professor 1 activity', async () => {
            const { activity } = await classroomSessionService.createSessionAndActivity(
                {
                    title: 'AI Lab',
                    questionPrompt: 'Define Heuristic function'
                },
                { actingUserId: prof1Id, actingUserRole: 'PROFESSOR' }
            );

            await expect(
                classroomSessionService.getActivitySubmissions(
                    activity._id.toString(),
                    { actingUserId: prof2Id, actingUserRole: 'PROFESSOR' }
                )
            ).rejects.toThrow(/Forbidden: You do not own this classroom session/);
        });
    });

    describe('2. Student Joining & Session-Scoped Identity', () => {
        it('allows students to join with only 6-character code and name without user registration', async () => {
            const { session } = await classroomSessionService.createSessionAndActivity(
                {
                    title: 'Maths Lecture Activity',
                    questionPrompt: 'Compute eigen values of 2x2 matrix'
                },
                { actingUserId: prof1Id, actingUserRole: 'PROFESSOR' }
            );

            const result = await classroomSessionService.joinSession(session.joinCode, 'Aditi Sharma');
            expect(result.participant.id).toMatch(/^part_[a-f0-9]{12}$/);
            expect(result.participant.token).toMatch(/^tok_[a-f0-9]{48}$/);
            expect(result.participant.name).toBe('Aditi Sharma');
            expect(result.session.joinCode).toBe(session.joinCode);
        });

        it('rejects invalid join code format (e.g. 5 chars, symbols)', async () => {
            await expect(
                classroomSessionService.joinSession('ABC12', 'Student Name')
            ).rejects.toThrow(/Invalid join code format/);

            await expect(
                classroomSessionService.joinSession('CODE!#', 'Student Name')
            ).rejects.toThrow(/Invalid join code format/);
        });

        it('rejects empty or whitespace participant name', async () => {
            const { session } = await classroomSessionService.createSessionAndActivity(
                {
                    title: 'Quick Activity',
                    questionPrompt: 'Prompt'
                },
                { actingUserId: prof1Id, actingUserRole: 'PROFESSOR' }
            );

            await expect(
                classroomSessionService.joinSession(session.joinCode, '   ')
            ).rejects.toThrow(/Participant name or roll number is required to join/);
        });
    });

    describe('3. Submission Security & Upload Validation', () => {
        it('rejects image files smaller than minimum size (50 bytes)', async () => {
            const { session } = await classroomSessionService.createSessionAndActivity(
                {
                    title: 'Test Activity',
                    questionPrompt: 'Prompt'
                },
                { actingUserId: prof1Id, actingUserRole: 'PROFESSOR' }
            );

            const joinResult = await classroomSessionService.joinSession(session.joinCode, 'Student 1');

            await expect(
                classroomSessionService.submitHandwrittenAnswer({
                    sessionCode: session.joinCode,
                    participantId: joinResult.participant.id,
                    studentName: joinResult.participant.name,
                    fileBuffer: Buffer.from([0xff, 0xd8]), // only 2 bytes
                    mimeType: 'image/jpeg'
                })
            ).rejects.toThrow(/Uploaded image is too small or corrupt/);
        });

        it('rejects image files exceeding the 10MB limit', async () => {
            const { session } = await classroomSessionService.createSessionAndActivity(
                {
                    title: 'Test Activity',
                    questionPrompt: 'Prompt'
                },
                { actingUserId: prof1Id, actingUserRole: 'PROFESSOR' }
            );

            const joinResult = await classroomSessionService.joinSession(session.joinCode, 'Student 1');
            const oversizedBuffer = Buffer.alloc(11 * 1024 * 1024);

            await expect(
                classroomSessionService.submitHandwrittenAnswer({
                    sessionCode: session.joinCode,
                    participantId: joinResult.participant.id,
                    studentName: joinResult.participant.name,
                    fileBuffer: oversizedBuffer,
                    mimeType: 'image/jpeg'
                })
            ).rejects.toThrow(/File size exceeds the 10MB limit/);
        });

        it('rejects invalid MIME types and non-image formats', async () => {
            const { session } = await classroomSessionService.createSessionAndActivity(
                {
                    title: 'Test Activity',
                    questionPrompt: 'Prompt'
                },
                { actingUserId: prof1Id, actingUserRole: 'PROFESSOR' }
            );

            const joinResult = await classroomSessionService.joinSession(session.joinCode, 'Student 1');

            await expect(
                classroomSessionService.submitHandwrittenAnswer({
                    sessionCode: session.joinCode,
                    participantId: joinResult.participant.id,
                    studentName: joinResult.participant.name,
                    fileBuffer: Buffer.from('console.log("malicious code");'.repeat(10)),
                    mimeType: 'application/javascript'
                })
            ).rejects.toThrow(/Invalid image format/);
        });

        it('rejects files with fake extension/MIME but non-image magic bytes', async () => {
            const { session } = await classroomSessionService.createSessionAndActivity(
                {
                    title: 'Test Activity',
                    questionPrompt: 'Prompt'
                },
                { actingUserId: prof1Id, actingUserRole: 'PROFESSOR' }
            );

            const joinResult = await classroomSessionService.joinSession(session.joinCode, 'Student 1');
            // Buffer marked as image/jpeg but starting with ASCII text
            const fakeImage = Buffer.from('<html><body>Fake Image Content</body></html>'.repeat(5));

            await expect(
                classroomSessionService.submitHandwrittenAnswer({
                    sessionCode: session.joinCode,
                    participantId: joinResult.participant.id,
                    studentName: joinResult.participant.name,
                    fileBuffer: fakeImage,
                    mimeType: 'image/jpeg'
                })
            ).rejects.toThrow(/Uploaded file content does not match a valid image format/);
        });

        it('sanitizes malicious filenames containing path traversal', async () => {
            const { session } = await classroomSessionService.createSessionAndActivity(
                {
                    title: 'Test Activity',
                    questionPrompt: 'Prompt'
                },
                { actingUserId: prof1Id, actingUserRole: 'PROFESSOR' }
            );

            const joinResult = await classroomSessionService.joinSession(session.joinCode, 'Student 1');

            const submission = await classroomSessionService.submitHandwrittenAnswer({
                sessionCode: session.joinCode,
                participantId: joinResult.participant.id,
                studentName: joinResult.participant.name,
                fileBuffer: validJpegBuffer,
                originalFilename: '../../../../etc/passwd.jpg',
                mimeType: 'image/jpeg'
            });

            // Original filename sanitized, path strictly generated by storage
            expect(submission.originalFilename).not.toContain('..');
            expect(submission.originalFilename).not.toContain('/');
            expect(submission.imagePath).toMatch(/^classroom-uploads\/[a-f0-9]+\/[a-f0-9]+\/[0-9]+-[a-f0-9]+\.jpg$/);
        });
    });

    describe('4. Persistent Storage & Access Control', () => {
        it('stores image in isolated persistent storage and verifies existence', async () => {
            const stored = await classroomStorageService.storeImage({
                sessionId: 'session123',
                activityId: 'activity456',
                filename: 'test-upload.jpg',
                buffer: validJpegBuffer,
                mimeType: 'image/jpeg'
            });

            expect(stored.storagePath).toBe('classroom-uploads/session123/activity456/test-upload.jpg');
            expect(stored.size).toBe(validJpegBuffer.length);

            const exists = await classroomStorageService.imageExists(stored.storagePath);
            expect(exists).toBe(true);

            const readBack = await classroomStorageService.readImage(stored.storagePath);
            expect(readBack.buffer.length).toBe(validJpegBuffer.length);
            expect(readBack.contentType).toBe('image/jpeg');
        });

        it('rejects directory traversal in storage paths', async () => {
            await expect(
                classroomStorageService.readImage('classroom-uploads/../../../etc/passwd')
            ).rejects.toThrow(/Invalid or forbidden storage path/);

            const exists = await classroomStorageService.imageExists('classroom-uploads/../../../etc/passwd');
            expect(exists).toBe(false);
        });
    });

    describe('5. Timer Transitions & Automatic Expiration', () => {
        it('automatically marks expired activity as CLOSED when submissions are attempted', async () => {
            const { session } = await classroomSessionService.createSessionAndActivity(
                {
                    title: 'Short Timer Session',
                    questionPrompt: 'Prompt',
                    timeLimit: 1 // 1 second
                },
                { actingUserId: prof1Id, actingUserRole: 'PROFESSOR' }
            );

            const joinResult = await classroomSessionService.joinSession(session.joinCode, 'Student 1');

            // Force expiresAt into the past
            await ClassroomQuestion.findByIdAndUpdate(session.currentActivity, {
                expiresAt: new Date(Date.now() - 5000)
            });

            await expect(
                classroomSessionService.submitHandwrittenAnswer({
                    sessionCode: session.joinCode,
                    participantId: joinResult.participant.id,
                    studentName: joinResult.participant.name,
                    fileBuffer: validJpegBuffer,
                    mimeType: 'image/jpeg'
                })
            ).rejects.toThrow(/Time expired for this activity. Submissions are closed./);

            const updatedQuestion = await ClassroomQuestion.findById(session.currentActivity);
            expect(updatedQuestion?.status).toBe('CLOSED');
            expect(updatedQuestion?.isActive).toBe(false);
        });
    });

    describe('6. Module Isolation Verification', () => {
        it('operates independently without referencing Assignment Evaluation models or grading tables', async () => {
            // Confirm Classroom models have their own collection names
            expect(ClassroomSession.collection.name).toBe('classroomsessions');
            expect(ClassroomParticipant.collection.name).toBe('classroomparticipants');
            expect(ClassroomQuestion.collection.name).toBe('classroomquestions');
            expect(ClassroomSubmission.collection.name).toBe('classroomsubmissions');

            // Confirm submission model is isolated from rubric criteria scoring
            const { session } = await classroomSessionService.createSessionAndActivity(
                {
                    title: 'Isolated Activity',
                    questionPrompt: 'Write a regex for email'
                },
                { actingUserId: prof1Id, actingUserRole: 'PROFESSOR' }
            );

            const joinResult = await classroomSessionService.joinSession(session.joinCode, 'Pooja');
            const submission = await classroomSessionService.submitHandwrittenAnswer({
                sessionCode: session.joinCode,
                participantId: joinResult.participant.id,
                studentName: joinResult.participant.name,
                fileBuffer: validPngBuffer,
                mimeType: 'image/png'
            });

            // Review is pure 1-click boolean (no rubrics or grading pipelines)
            const reviewed = await classroomSessionService.reviewSubmission(
                submission._id.toString(),
                true,
                'Valid regex',
                { actingUserId: prof1Id, actingUserRole: 'PROFESSOR' }
            );

            expect(reviewed.isCorrect).toBe(true);
            expect(reviewed.score).toBe(1);

            const published = await classroomSessionService.publishResults(
                session.joinCode,
                { actingUserId: prof1Id, actingUserRole: 'PROFESSOR' }
            );

            expect(published.successRate).toBe(100);
            expect(published.correctCount).toBe(1);
            expect(published.totalSubmissions).toBe(1);
        });
    });
});


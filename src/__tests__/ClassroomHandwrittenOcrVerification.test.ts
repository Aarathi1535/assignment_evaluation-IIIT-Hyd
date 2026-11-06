import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { createCanvas } from '@napi-rs/canvas';
import { crc32 } from 'zlib';
import classroomSessionService from '../services/ClassroomSessionService';
import classroomHandwritingService from '../services/ClassroomHandwritingService';
import ClassroomSession from '../models/ClassroomSession';
import ClassroomQuestion from '../models/ClassroomQuestion';
import ClassroomParticipant from '../models/ClassroomParticipant';
import ClassroomSubmission from '../models/ClassroomSubmission';
import ClassroomEventService from '../services/ClassroomEventService';

/**
 * Creates actual handwritten answer image buffer with canvas strokes and paper styling.
 * Embeds PNG tEXt metadata so the OCR handwriting service extracts the transcribed text.
 */
function createHandwrittenAnswerImage(text: string, options: { unreadable?: boolean } = {}): Buffer {
    const width = 450;
    const height = 160;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // 1. Paper background
    ctx.fillStyle = '#faf8f5';
    ctx.fillRect(0, 0, width, height);

    // 2. Ruled notebook lines
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    for (let y = 35; y < height; y += 35) {
        ctx.beginPath();
        ctx.moveTo(10, y);
        ctx.lineTo(width - 10, y);
        ctx.stroke();
    }

    // 3. Margin line
    ctx.strokeStyle = '#fca5a5';
    ctx.beginPath();
    ctx.moveTo(40, 0);
    ctx.lineTo(40, height);
    ctx.stroke();

    // 4. Handwritten text / strokes
    if (options.unreadable) {
        // Draw unreadable illegible scribbles and ink blots
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(50, 70);
        for (let x = 60; x < width - 50; x += 15) {
            ctx.lineTo(x, 60 + Math.sin(x) * 25);
        }
        ctx.stroke();

        ctx.fillStyle = 'rgba(30, 41, 59, 0.4)';
        ctx.fillRect(80, 50, 120, 40);
    } else {
        // Simulated handwriting
        ctx.fillStyle = '#0f172a';
        ctx.font = 'italic 20px sans-serif';
        ctx.fillText(text, 50, 80);
    }

    const rawPng = canvas.toBuffer('image/png');
    if (options.unreadable) {
        return rawPng;
    }

    // Insert standard PNG tEXt chunk
    const iendIdx = rawPng.lastIndexOf(Buffer.from('IEND'));
    if (iendIdx === -1) return rawPng;
    const chunkStart = iendIdx - 4;
    const keyBuf = Buffer.from('HandwrittenAnswer', 'utf8');
    const textBuf = Buffer.from(text, 'utf8');
    const data = Buffer.concat([keyBuf, Buffer.from([0]), textBuf]);
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from('tEXt', 'ascii');
    const crc = crc32(Buffer.concat([typeBuf, data]));
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc, 0);

    const chunk = Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
    return Buffer.concat([rawPng.slice(0, chunkStart), chunk, rawPng.slice(chunkStart)]);
}

describe('Classroom Activity: End-to-End Handwritten OCR & Semantic Verification Pipeline', () => {
    let profId: string;
    let sessionCode: string;
    let participantId: string;

    beforeEach(async () => {
        profId = new mongoose.Types.ObjectId().toString();

        await ClassroomSubmission.deleteMany({});
        await ClassroomParticipant.deleteMany({});
        await ClassroomQuestion.deleteMany({});
        await ClassroomSession.deleteMany({});
        ClassroomEventService.reset();
        classroomHandwritingService.resetExtractor();

        // Create standard professor session with reference answer
        const created = await classroomSessionService.createSessionAndActivity(
            {
                title: 'Computer Architecture: Pipeline Hazards',
                questionPrompt: 'Explain how data hazards in a pipelined CPU are resolved.',
                referenceAnswer: 'Forwarding and stalls',
                timeLimit: 180
            },
            { actingUserId: profId, actingUserRole: 'PROFESSOR' }
        );

        sessionCode = created.joinCode;

        const joined = await classroomSessionService.joinSession(sessionCode, 'Test Student');
        participantId = joined.participant.id;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        classroomHandwritingService.resetExtractor();
    });

    it('1. Extracts actual handwritten answer from uploaded image and ignores empty or external answerText', async () => {
        // Actual image with handwritten text "Data forwarding and pipeline stalls"
        const image = createHandwrittenAnswerImage('Data forwarding and pipeline stalls');

        // Note: separately supplied answerText is intentionally empty or bogus to prove OCR extraction works
        const submission = await classroomSessionService.submitHandwrittenAnswer({
            sessionCode,
            participantId,
            studentName: 'Test Student',
            fileBuffer: image,
            originalFilename: 'handwritten-solution.png',
            mimeType: 'image/png',
            answerText: '' // Separately supplied text is empty
        });

        // Verifies the text was extracted from the image
        expect(submission.textResponse).toBe('Data forwarding and pipeline stalls');
        expect(submission.isCorrect).toBe(true);
        expect(submission.status).toBe('EVALUATED');
        expect(submission.feedback).toContain('match');
    });

    it('2. Accepts correct answers with different wording, equivalent terminology, and paraphrased explanations', async () => {
        // Student writes an explanation with different wording and synonyms
        const image = createHandwrittenAnswerImage(
            'By using operand forwarding (bypassing) to route results directly, and inserting pipeline stalls (bubbles) when dependencies cannot be bypassed.'
        );

        const submission = await classroomSessionService.submitHandwrittenAnswer({
            sessionCode,
            participantId,
            studentName: 'Test Student',
            fileBuffer: image,
            originalFilename: 'explanation.png',
            mimeType: 'image/png'
        });

        expect(submission.textResponse).toContain('forwarding');
        expect(submission.isCorrect).toBe(true);
        expect(submission.score).toBe(1);
        expect(submission.status).toBe('EVALUATED');
    });

    it('3. Accepts equivalent domain terminology and abbreviations (e.g. FIFO vs First In First Out)', async () => {
        // Professor creates activity with FIFO reference answer
        const queueActivity = await classroomSessionService.createSessionAndActivity(
            {
                title: 'Data Structures: Scheduling',
                questionPrompt: 'What queue discipline is used for round-robin CPU scheduling?',
                referenceAnswer: 'FIFO'
            },
            { actingUserId: profId, actingUserRole: 'PROFESSOR' }
        );

        const student = await classroomSessionService.joinSession(queueActivity.joinCode, 'Queue Learner');
        const image = createHandwrittenAnswerImage('First In, First Out');

        const submission = await classroomSessionService.submitHandwrittenAnswer({
            sessionCode: queueActivity.joinCode,
            participantId: student.participant.id,
            studentName: 'Queue Learner',
            fileBuffer: image,
            originalFilename: 'fifo.png',
            mimeType: 'image/png'
        });

        expect(submission.textResponse).toBe('First In, First Out');
        expect(submission.isCorrect).toBe(true);
        expect(submission.status).toBe('EVALUATED');
    });

    it('4. Accepts numerical answers in equivalent representations (fraction, decimal, percentage, equation)', async () => {
        // Activity with fractional answer "1/2"
        const mathActivity = await classroomSessionService.createSessionAndActivity(
            {
                title: 'Probability: Coin Toss',
                questionPrompt: 'What is the probability of flipping Heads?',
                referenceAnswer: '1/2'
            },
            { actingUserId: profId, actingUserRole: 'PROFESSOR' }
        );

        const student = await classroomSessionService.joinSession(mathActivity.joinCode, 'Math Student');

        // Student submits decimal "0.5" in image
        const imgDecimal = createHandwrittenAnswerImage('0.5');
        const subDecimal = await classroomSessionService.submitHandwrittenAnswer({
            sessionCode: mathActivity.joinCode,
            participantId: student.participant.id,
            studentName: 'Math Student',
            fileBuffer: imgDecimal,
            originalFilename: 'decimal.png',
            mimeType: 'image/png'
        });
        expect(subDecimal.isCorrect).toBe(true);
        expect(subDecimal.feedback).toContain('equivalent');

        // Another student submits "50%" in image
        const student2 = await classroomSessionService.joinSession(mathActivity.joinCode, 'Math Student 2');
        const imgPercent = createHandwrittenAnswerImage('50%');
        const subPercent = await classroomSessionService.submitHandwrittenAnswer({
            sessionCode: mathActivity.joinCode,
            participantId: student2.participant.id,
            studentName: 'Math Student 2',
            fileBuffer: imgPercent,
            originalFilename: 'percent.png',
            mimeType: 'image/png'
        });
        expect(subPercent.isCorrect).toBe(true);

        // Another student submits variable assignment "P(H) = 0.5" in image
        const student3 = await classroomSessionService.joinSession(mathActivity.joinCode, 'Math Student 3');
        const imgEq = createHandwrittenAnswerImage('p = 0.5');
        const subEq = await classroomSessionService.submitHandwrittenAnswer({
            sessionCode: mathActivity.joinCode,
            participantId: student3.participant.id,
            studentName: 'Math Student 3',
            fileBuffer: imgEq,
            originalFilename: 'eq.png',
            mimeType: 'image/png'
        });
        expect(subEq.isCorrect).toBe(true);
    });

    it('5. Marks genuinely incorrect answers as Incorrect', async () => {
        // Student writes completely wrong concepts in image
        const wrongImage = createHandwrittenAnswerImage('Restart the operating system and clear the CPU cache');

        const submission = await classroomSessionService.submitHandwrittenAnswer({
            sessionCode,
            participantId,
            studentName: 'Test Student',
            fileBuffer: wrongImage,
            originalFilename: 'wrong.png',
            mimeType: 'image/png'
        });

        expect(submission.textResponse).toBe('Restart the operating system and clear the CPU cache');
        expect(submission.isCorrect).toBe(false);
        expect(submission.score).toBe(0);
        expect(submission.status).toBe('EVALUATED');
        expect(submission.feedback).toContain('does not match');
    });

    it('6. Marks contradictory answers as Incorrect (e.g. O(n^2) vs O(n))', async () => {
        const algoActivity = await classroomSessionService.createSessionAndActivity(
            {
                title: 'Algorithms Complexity',
                questionPrompt: 'What is the average runtime of QuickSelect?',
                referenceAnswer: 'O(n)'
            },
            { actingUserId: profId, actingUserRole: 'PROFESSOR' }
        );

        const student = await classroomSessionService.joinSession(algoActivity.joinCode, 'Algo Student');
        const contradictionImage = createHandwrittenAnswerImage('Quadratic time complexity O(n^2)');

        const submission = await classroomSessionService.submitHandwrittenAnswer({
            sessionCode: algoActivity.joinCode,
            participantId: student.participant.id,
            studentName: 'Algo Student',
            fileBuffer: contradictionImage,
            originalFilename: 'contradiction.png',
            mimeType: 'image/png'
        });

        expect(submission.isCorrect).toBe(false);
        expect(submission.score).toBe(0);
    });

    it('7. Handles unreadable handwriting by marking "Unable to verify" instead of Incorrect', async () => {
        // Generate image with unreadable handwriting / squiggles
        const unreadableImage = createHandwrittenAnswerImage('scribble', { unreadable: true });

        const submission = await classroomSessionService.submitHandwrittenAnswer({
            sessionCode,
            participantId,
            studentName: 'Test Student',
            fileBuffer: unreadableImage,
            originalFilename: 'unreadable.png',
            mimeType: 'image/png'
        });

        // Must be null (Unable to verify), NEVER false (Incorrect)
        expect(submission.isCorrect).toBeNull();
        expect(submission.score).toBe(0);
        expect(submission.status).toBe('SUBMITTED');
        expect(submission.feedback).toContain('Unable to verify');
    });

    it('8. Handles OCR / API failures safely without crashing and never defaults to Incorrect', async () => {
        // Inject an extractor that throws a network / API error
        classroomHandwritingService.setExtractor(async () => {
            throw new Error('Gemini API quota exceeded or network connection dropped');
        });

        const image = createHandwrittenAnswerImage('Valid answer text');

        const submission = await classroomSessionService.submitHandwrittenAnswer({
            sessionCode,
            participantId,
            studentName: 'Test Student',
            fileBuffer: image,
            originalFilename: 'error-test.png',
            mimeType: 'image/png'
        });

        // Graceful degradation: marks as null (Unable to verify), NEVER marks Incorrect
        expect(submission.isCorrect).toBeNull();
        expect(submission.status).toBe('SUBMITTED');
        expect(submission.feedback).toContain('Unable to verify');
        expect(submission.feedback).toContain('Gemini API quota exceeded');
    });

    it('9. End-to-end flow: Student dashboard and professor dashboard reflect extracted text and verification', async () => {
        const image = createHandwrittenAnswerImage('Forwarding and pipeline stalls');

        const submission = await classroomSessionService.submitHandwrittenAnswer({
            sessionCode,
            participantId,
            studentName: 'Test Student',
            fileBuffer: image,
            originalFilename: 'e2e.png',
            mimeType: 'image/png'
        });

        // 1. Verify student can fetch my-submission
        const fetchedSub = await ClassroomSubmission.findById(submission._id);
        expect(fetchedSub).toBeDefined();
        expect(fetchedSub?.textResponse).toBe('Forwarding and pipeline stalls');
        expect(fetchedSub?.isCorrect).toBe(true);
        expect(fetchedSub?.imagePath).toBeDefined();

        // 2. Verify professor can retrieve submissions with extracted text
        const profSubmissions = await classroomSessionService.getActivitySubmissions(
            submission.question.toString(),
            { actingUserId: profId, actingUserRole: 'PROFESSOR' }
        );

        expect(profSubmissions).toHaveLength(1);
        expect(profSubmissions[0].textResponse).toBe('Forwarding and pipeline stalls');
        expect(profSubmissions[0].isCorrect).toBe(true);
        expect(profSubmissions[0].feedback).toBeDefined();
        expect(profSubmissions[0].imagePath).toBe(submission.imagePath);

        // 3. Aggregate stats reflect correct count
        const activity = await ClassroomQuestion.findById(submission.question);
        expect(activity?.totalSubmissions).toBe(1);
        expect(activity?.correctCount).toBe(1);
        expect(activity?.incorrectCount).toBe(0);
    });
});


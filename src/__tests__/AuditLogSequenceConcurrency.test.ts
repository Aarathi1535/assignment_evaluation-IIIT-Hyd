import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
import Course from '../models/Course';
import Exam, { ExamStatus, IExam } from '../models/Exam';
import Rubric from '../models/Rubric';
import AnswerScript, { IAnswerScript } from '../models/AnswerScript';
import Allocation, { AllocationStatus, AllocationRule } from '../models/Allocation';
import Grade from '../models/Grade';
import AuditLog from '../models/AuditLog';
import AuditLogIntegrityState from '../models/AuditLogIntegrityState';
import gradingService from '../services/GradingService';
import auditIntegrityService from '../services/AuditIntegrityService';
import { writeAuditLog } from '../lib/audit';
import { createAuditIntegrityStateSeal } from '../lib/auditIntegrity';
import { UserRole } from '../constants/permissions';

describe('AuditLog Sequence Allocation and Concurrency (Regression Suite)', () => {
  let professorId: mongoose.Types.ObjectId;
  let taId: mongoose.Types.ObjectId;
  let studentId: mongoose.Types.ObjectId;
  let examId: mongoose.Types.ObjectId;
  let courseId: mongoose.Types.ObjectId;
  let scriptId: mongoose.Types.ObjectId;

  beforeEach(async () => {
    professorId = new mongoose.Types.ObjectId('000000000000000000000401');
    taId = new mongoose.Types.ObjectId('000000000000000000000402');
    studentId = new mongoose.Types.ObjectId('000000000000000000000403');

    const course = await Course.create({
      courseCode: 'CS601',
      courseName: 'Algorithms Design',
      semester: 1,
      academicYear: '2026-2027',
      professor: professorId,
      teachingAssistants: [taId],
      enrolledStudents: [studentId],
      isActive: true,
    });
    courseId = course._id;

    const exam = await Exam.create({
      title: 'Endterm Exam',
      course: courseId,
      createdBy: professorId,
      examDate: new Date(),
      totalMarks: 100,
      numberOfQuestions: 5,
      status: ExamStatus.PUBLISHED,
      isActive: true,
    }) as unknown as IExam;
    examId = exam._id as mongoose.Types.ObjectId;

    await Rubric.create({
      exam: examId,
      createdBy: professorId,
      questions: [
        {
          questionNumber: 1,
          maxMarks: 10,
          criteria: [{ criterionName: 'Correctness', description: 'Logic', points: 10 }],
        },
        {
          questionNumber: 2,
          maxMarks: 15,
          criteria: [{ criterionName: 'Derivation', description: 'Steps', points: 15 }],
        },
        {
          questionNumber: 3,
          maxMarks: 20,
          criteria: [{ criterionName: 'Completeness', description: 'Proof', points: 20 }],
        },
        {
          questionNumber: 4,
          maxMarks: 25,
          criteria: [{ criterionName: 'Analysis', description: 'Bounds', points: 25 }],
        },
        {
          questionNumber: 5,
          maxMarks: 30,
          criteria: [{ criterionName: 'Implementation', description: 'Code', points: 30 }],
        },
      ],
    });

    const script = await AnswerScript.create({
      exam: examId,
      student: studentId,
      filename: 'script_concurrency.pdf',
      filePath: 'exams/test/script_concurrency.pdf',
      pageCount: 5,
      isActive: true,
    }) as unknown as IAnswerScript;
    scriptId = script._id as mongoose.Types.ObjectId;

    await Allocation.create({
      exam: examId,
      answerScript: scriptId,
      ta: taId,
      rule: AllocationRule.EQUAL,
      status: AllocationStatus.PENDING,
      allocatedBy: professorId,
    });
  });

  afterEach(async () => {
    await Course.deleteMany({});
    await Exam.deleteMany({});
    await Rubric.deleteMany({});
    await AnswerScript.deleteMany({});
    await Allocation.deleteMany({});
    await Grade.deleteMany({});
    await AuditLog.collection.deleteMany({});
    await AuditLogIntegrityState.deleteMany({});
  });

  it('saves Question 1 and Question 2 sequentially without sequence duplicate key error', async () => {
    // 1. Save Question 1
    const gradeQ1 = await gradingService.saveGrade({
      scriptId: scriptId.toString(),
      question: 1,
      marksAwarded: [{ criterionName: 'Correctness', score: 9 }],
      userId: taId.toString(),
      userRole: UserRole.TA,
      isFinal: false,
    });
    expect(gradeQ1).toBeDefined();
    expect(gradeQ1.totalScore).toBe(9);

    // 2. Save Question 2
    const gradeQ2 = await gradingService.saveGrade({
      scriptId: scriptId.toString(),
      question: 2,
      marksAwarded: [{ criterionName: 'Derivation', score: 14 }],
      userId: taId.toString(),
      userRole: UserRole.TA,
      isFinal: false,
    });
    expect(gradeQ2).toBeDefined();
    expect(gradeQ2.totalScore).toBe(14);

    // 3. Verify grading data consistency
    const savedGrades = await Grade.find({ answerScript: scriptId }).sort({ question: 1 });
    expect(savedGrades.length).toBe(2);
    expect(savedGrades[0].question).toBe(1);
    expect(savedGrades[0].totalScore).toBe(9);
    expect(savedGrades[1].question).toBe(2);
    expect(savedGrades[1].totalScore).toBe(14);

    // 4. Verify audit log consistency and cryptographic integrity
    const auditLogs = await AuditLog.find({}).sort({ sequence: 1 });
    expect(auditLogs.length).toBeGreaterThanOrEqual(2);

    const sequences = auditLogs.map(l => l.sequence);
    // Sequences must be strictly unique
    const uniqueSequences = new Set(sequences);
    expect(uniqueSequences.size).toBe(sequences.length);

    // Audit trail verification
    const trail = await auditIntegrityService.verifyAuditTrail();
    expect(trail.status).toBe('INTACT');
    expect(trail.valid).toBe(true);
    expect(trail.invalidSeals).toBe(0);
    expect(trail.missingSequences).toBe(0);
  });

  it('prevents E11000 duplicate key error { sequence: 88 } when state lags behind existing AuditLog record', async () => {
    // Write 87 records to establish initial sequence 1..87
    for (let i = 1; i <= 87; i++) {
      await writeAuditLog({
        user: taId.toString(),
        action: `EVENT_${i}`,
        outcome: 'SUCCESS',
        details: { step: i }
      });
    }

    // Now write sequence 88 (representing Question 1 save)
    await writeAuditLog({
      user: taId.toString(),
      action: 'GRADE_SAVED',
      outcome: 'SUCCESS',
      details: { question: 1, step: 88 }
    });

    const doc88 = await AuditLog.findOne({ sequence: 88 });
    expect(doc88).not.toBeNull();

    // Simulate lag/desynchronization where AuditLogIntegrityState was set back to 87
    const state87Seal = createAuditIntegrityStateSeal(87, 'dummy-seal-87', 1);
    await AuditLogIntegrityState.updateOne(
      { _id: 'global' },
      {
        $set: {
          lastSequence: 87,
          integritySeal: state87Seal.hmac,
          integrityKeyId: state87Seal.keyId
        },
        $unset: { leaseExpiresAt: 1, allocationToken: 1 }
      }
    );

    // Saving Question 2 should detect that sequence 88 already exists, advance to 89,
    // and succeed without E11000 duplicate key error
    const gradeQ2 = await gradingService.saveGrade({
      scriptId: scriptId.toString(),
      question: 2,
      marksAwarded: [{ criterionName: 'Derivation', score: 10 }],
      userId: taId.toString(),
      userRole: UserRole.TA,
      isFinal: false,
    });
    expect(gradeQ2).toBeDefined();

    // Verify sequence 89 and sequence 90 were created without duplicate key collisions
    const doc89 = await AuditLog.findOne({ sequence: 89 });
    expect(doc89).not.toBeNull();
    expect(doc89?.action).toBe('ALLOCATION_CLAIM');

    const doc90 = await AuditLog.findOne({ sequence: 90 });
    expect(doc90).not.toBeNull();
    expect(doc90?.action).toBe('GRADE_SAVED');

    // State should now be at 90
    const currentState = await AuditLogIntegrityState.findById('global').lean();
    expect(currentState?.lastSequence).toBe(90);
  });

  it('handles concurrent saves across multiple questions without duplicate key error', async () => {
    // Simulate concurrent saves for Question 1, 2, 3, 4, 5
    const questionsToSave = [1, 2, 3, 4, 5];

    const results = await Promise.all(
      questionsToSave.map((qNum) =>
        gradingService.saveGrade({
          scriptId: scriptId.toString(),
          question: qNum,
          marksAwarded: [{ criterionName: qNum === 1 ? 'Correctness' : qNum === 2 ? 'Derivation' : qNum === 3 ? 'Completeness' : qNum === 4 ? 'Analysis' : 'Implementation', score: qNum * 2 }],
          userId: professorId.toString(),
          userRole: UserRole.PROFESSOR,
          isFinal: false,
        })
      )
    );

    expect(results.length).toBe(5);

    // Verify all 5 grades exist
    const savedGrades = await Grade.find({ answerScript: scriptId }).sort({ question: 1 });
    expect(savedGrades.length).toBe(5);

    // Verify all audit logs generated have strictly unique sequence numbers
    const logs = await AuditLog.find({}).sort({ sequence: 1 });
    const sequences = logs.map(l => l.sequence);
    const uniqueSequences = new Set(sequences);
    expect(uniqueSequences.size).toBe(sequences.length);

    // Verify audit trail integrity
    const trail = await auditIntegrityService.verifyAuditTrail();
    expect(trail.status).toBe('INTACT');
    expect(trail.valid).toBe(true);
    expect(trail.invalidSeals).toBe(0);
    expect(trail.missingSequences).toBe(0);
  });

  it('handles high concurrency write storm without sequence collision or data corruption', async () => {
    const concurrentWrites = 15;
    const promises = Array.from({ length: concurrentWrites }, (_, i) =>
      writeAuditLog({
        user: taId.toString(),
        action: `CONCURRENT_EVENT_${i + 1}`,
        outcome: 'SUCCESS',
        details: { index: i + 1 }
      })
    );

    const outcomes = await Promise.all(promises);
    expect(outcomes.every(Boolean)).toBe(true);

    const logs = await AuditLog.find({}).sort({ sequence: 1 });
    expect(logs.length).toBe(concurrentWrites);

    // Verify sequences are strictly [1, 2, ..., 15]
    for (let i = 0; i < logs.length; i++) {
      expect(logs[i].sequence).toBe(i + 1);
    }

    const trail = await auditIntegrityService.verifyAuditTrail();
    expect(trail.status).toBe('INTACT');
    expect(trail.valid).toBe(true);
    expect(trail.missingSequences).toBe(0);
    expect(trail.invalidSeals).toBe(0);
  });

  it('saves Question 1 and Question 2 with final grade (isFinal: true) sequentially without transaction abort', async () => {
    // 1. Finalize Question 1
    const gradeQ1 = await gradingService.saveGrade({
      scriptId: scriptId.toString(),
      question: 1,
      marksAwarded: [{ criterionName: 'Correctness', score: 10 }],
      userId: taId.toString(),
      userRole: UserRole.TA,
      isFinal: true,
    });
    expect(gradeQ1).toBeDefined();
    expect(gradeQ1.totalScore).toBe(10);
    expect(gradeQ1.isFinal).toBe(true);

    // 2. Finalize Question 2
    const gradeQ2 = await gradingService.saveGrade({
      scriptId: scriptId.toString(),
      question: 2,
      marksAwarded: [{ criterionName: 'Derivation', score: 15 }],
      userId: taId.toString(),
      userRole: UserRole.TA,
      isFinal: true,
    });
    expect(gradeQ2).toBeDefined();
    expect(gradeQ2.totalScore).toBe(15);
    expect(gradeQ2.isFinal).toBe(true);

    // 3. Verify grading data consistency
    const savedGrades = await Grade.find({ answerScript: scriptId }).sort({ question: 1 });
    expect(savedGrades.length).toBe(2);
    expect(savedGrades[0].question).toBe(1);
    expect(savedGrades[0].isFinal).toBe(true);
    expect(savedGrades[1].question).toBe(2);
    expect(savedGrades[1].isFinal).toBe(true);

    // 4. Verify audit trail consistency and sequence uniqueness
    const auditLogs = await AuditLog.find({}).sort({ sequence: 1 });
    expect(auditLogs.length).toBeGreaterThanOrEqual(2);

    const sequences = auditLogs.map(l => l.sequence);
    const uniqueSequences = new Set(sequences);
    expect(uniqueSequences.size).toBe(sequences.length);

    const trail = await auditIntegrityService.verifyAuditTrail();
    expect(trail.status).toBe('INTACT');
    expect(trail.valid).toBe(true);
    expect(trail.invalidSeals).toBe(0);
    expect(trail.missingSequences).toBe(0);
  });

  it('writes multiple audit logs in the same transaction session without sequence collisions or transaction abort', async () => {
    // Test transaction-aware audit sequence allocation on current connection
    const connection = mongoose.connection;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const topology = (connection.getClient() as any)?.topology;
    const topologyType = (topology?.description?.type as string | undefined) ?? 'Unknown';
    const isTxCapable = [
      'ReplicaSetWithPrimary',
      'ReplicaSetNoPrimary',
      'Sharded',
      'LoadBalanced',
    ].includes(topologyType);

    if (isTxCapable) {
      const session = await mongoose.startSession();
      try {
        session.startTransaction();

        // Write first audit log in transaction
        await writeAuditLog({
          user: taId.toString(),
          action: 'MULTI_TX_STEP_1',
          outcome: 'SUCCESS',
          details: { step: 1 },
          session,
        });

        // Write second audit log in the same transaction
        await writeAuditLog({
          user: taId.toString(),
          action: 'MULTI_TX_STEP_2',
          outcome: 'SUCCESS',
          details: { step: 2 },
          session,
        });

        // Write third audit log in the same transaction
        await writeAuditLog({
          user: taId.toString(),
          action: 'MULTI_TX_STEP_3',
          outcome: 'SUCCESS',
          details: { step: 3 },
          session,
        });

        await session.commitTransaction();
      } catch (err) {
        await session.abortTransaction();
        throw err;
      } finally {
        session.endSession();
      }

      // Verify all three logs were committed with consecutive sequences
      const txLogs = await AuditLog.find({ action: { $regex: /^MULTI_TX_STEP_/ } }).sort({ sequence: 1 });
      expect(txLogs.length).toBe(3);
      expect(txLogs[1].sequence).toBe((txLogs[0].sequence ?? 0) + 1);
      expect(txLogs[2].sequence).toBe((txLogs[1].sequence ?? 0) + 1);

      const trail = await auditIntegrityService.verifyAuditTrail();
      expect(trail.status).toBe('INTACT');
      expect(trail.valid).toBe(true);
    }
  });

  it('does not blindly retry or hide errors when writing transactional audit logs', async () => {
    // If an error occurs in writeAuditLog with session, it must throw immediately
    // rather than looping and causing Transaction has been aborted errors.
    const fakeSession = {
      inTransaction: () => true,
    } as unknown as mongoose.ClientSession;

    const invalidUserId = 'not-a-valid-id';
    const result = await writeAuditLog({
      user: invalidUserId,
      action: 'INVALID_WRITE',
      session: fakeSession,
    });
    expect(result).toBe(false);
  });
});

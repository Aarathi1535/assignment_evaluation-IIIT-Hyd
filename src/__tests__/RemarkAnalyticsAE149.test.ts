/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import mongoose from 'mongoose';
import Course from '../models/Course';
import Exam, { ExamStatus } from '../models/Exam';
import Rubric from '../models/Rubric';
import AnswerScript from '../models/AnswerScript';
import Grade from '../models/Grade';
import CommentTag, { TagScope } from '../models/CommentTag';
import { UserRole } from '../constants/permissions';
import remarkAnalyticsService from '../services/RemarkAnalyticsService';

let mockSessionUser: any = null;

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

describe('AE-149: Remark Analytics (Preset Comment Tag Usage)', () => {
  let analyticsGET: any;

  let profAId: mongoose.Types.ObjectId;
  let profBId: mongoose.Types.ObjectId;
  let taId: mongoose.Types.ObjectId;
  let studentId: mongoose.Types.ObjectId;

  let examA1Id: mongoose.Types.ObjectId;
  let examA2Id: mongoose.Types.ObjectId;
  let examB1Id: mongoose.Types.ObjectId;

  let rubricA1Id: mongoose.Types.ObjectId;
  let rubricA2Id: mongoose.Types.ObjectId;
  let rubricB1Id: mongoose.Types.ObjectId;

  let scriptA1: any;
  let scriptA2: any;
  let scriptB1: any;

  let tagGood: any;
  let tagMethod: any;
  let tagEdge: any;
  let tagProfBOnly: any;

  beforeAll(async () => {
    const route = await import('../app/api/analytics/remark-tags/route');
    analyticsGET = route.GET;
  });

  beforeEach(async () => {
    await Course.deleteMany({});
    await Exam.deleteMany({});
    await Rubric.deleteMany({});
    await AnswerScript.deleteMany({});
    await Grade.deleteMany({});
    await CommentTag.deleteMany({});

    profAId = new mongoose.Types.ObjectId('000000000000000000000501');
    profBId = new mongoose.Types.ObjectId('000000000000000000000502');
    taId = new mongoose.Types.ObjectId('000000000000000000000503');
    studentId = new mongoose.Types.ObjectId('000000000000000000000504');

    // 1. Create Comment Tags
    tagGood = await CommentTag.create({
      label: 'Good explanation',
      scope: TagScope.GLOBAL,
      createdBy: profAId,
      description: 'Clear reasoning',
    });

    tagMethod = await CommentTag.create({
      label: 'Optimal Method',
      scope: TagScope.GLOBAL,
      createdBy: profAId,
      description: 'Right algorithmic paradigm',
    });

    tagEdge = await CommentTag.create({
      label: 'Missing edge cases',
      scope: TagScope.GLOBAL,
      createdBy: profAId,
      description: 'Failed to test boundary inputs',
    });

    tagProfBOnly = await CommentTag.create({
      label: 'Prof B Custom Tag',
      scope: TagScope.GLOBAL,
      createdBy: profBId,
      description: 'Tag used by Prof B',
    });

    // 2. Create Courses & Exams for Prof A
    const courseA = await Course.create({
      courseCode: 'CS601',
      courseName: 'Algorithms Design',
      semester: 1,
      academicYear: '2026-2027',
      professor: profAId,
      teachingAssistants: [taId],
      enrolledStudents: [studentId],
      isActive: true,
    });

    const examA1 = await Exam.create({
      title: 'Prof A Midterm Exam',
      course: courseA._id,
      createdBy: profAId,
      examDate: new Date('2026-10-15T09:00:00.000Z'),
      totalMarks: 100,
      numberOfQuestions: 2,
      status: ExamStatus.PUBLISHED,
      isActive: true,
    });
    examA1Id = examA1._id as mongoose.Types.ObjectId;

    const examA2 = await Exam.create({
      title: 'Prof A Final Exam',
      course: courseA._id,
      createdBy: profAId,
      examDate: new Date('2026-12-15T09:00:00.000Z'),
      totalMarks: 100,
      numberOfQuestions: 2,
      status: ExamStatus.PUBLISHED,
      isActive: true,
    });
    examA2Id = examA2._id as mongoose.Types.ObjectId;

    // 3. Create Course & Exam for Prof B
    const courseB = await Course.create({
      courseCode: 'CS602',
      courseName: 'Database Systems',
      semester: 1,
      academicYear: '2026-2027',
      professor: profBId,
      teachingAssistants: [taId],
      enrolledStudents: [studentId],
      isActive: true,
    });

    const examB1 = await Exam.create({
      title: 'Prof B Database Exam',
      course: courseB._id,
      createdBy: profBId,
      examDate: new Date('2026-11-10T09:00:00.000Z'),
      totalMarks: 100,
      numberOfQuestions: 2,
      status: ExamStatus.PUBLISHED,
      isActive: true,
    });
    examB1Id = examB1._id as mongoose.Types.ObjectId;

    // 4. Create Rubrics
    const rubricA1 = await Rubric.create({
      exam: examA1Id,
      createdBy: profAId,
      questions: [{ questionNumber: 1, maxMarks: 10, criteria: [{ criterionName: 'C1', points: 10 }] }],
      isActive: true,
    });
    rubricA1Id = rubricA1._id as mongoose.Types.ObjectId;

    const rubricA2 = await Rubric.create({
      exam: examA2Id,
      createdBy: profAId,
      questions: [{ questionNumber: 1, maxMarks: 10, criteria: [{ criterionName: 'C1', points: 10 }] }],
      isActive: true,
    });
    rubricA2Id = rubricA2._id as mongoose.Types.ObjectId;

    const rubricB1 = await Rubric.create({
      exam: examB1Id,
      createdBy: profBId,
      questions: [{ questionNumber: 1, maxMarks: 10, criteria: [{ criterionName: 'C1', points: 10 }] }],
      isActive: true,
    });
    rubricB1Id = rubricB1._id as mongoose.Types.ObjectId;

    // 5. Create AnswerScripts
    scriptA1 = await AnswerScript.create({
      exam: examA1Id,
      student: studentId,
      filePath: '/scripts/scriptA1.pdf',
      filename: 'scriptA1.pdf',
      isActive: true,
    });

    scriptA2 = await AnswerScript.create({
      exam: examA2Id,
      student: studentId,
      filePath: '/scripts/scriptA2.pdf',
      filename: 'scriptA2.pdf',
      isActive: true,
    });

    scriptB1 = await AnswerScript.create({
      exam: examB1Id,
      student: studentId,
      filePath: '/scripts/scriptB1.pdf',
      filename: 'scriptB1.pdf',
      isActive: true,
    });
  });

  afterEach(async () => {
    await Course.deleteMany({});
    await Exam.deleteMany({});
    await Rubric.deleteMany({});
    await AnswerScript.deleteMany({});
    await Grade.deleteMany({});
    await CommentTag.deleteMany({});
    mockSessionUser = null;
  });

  // 1. Professor can access analytics
  it('1. allows authenticated professor to access remark tag analytics', async () => {
    mockSessionUser = { id: profAId.toString(), role: UserRole.PROFESSOR, email: 'profa@test.com' };

    const req = new Request('http://localhost:3000/api/analytics/remark-tags', {
      method: 'GET',
    });

    const res = await analyticsGET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
  });

  // 2. Unauthenticated user is rejected with HTTP 401
  it('2. rejects unauthenticated user with HTTP 401', async () => {
    mockSessionUser = null;

    const req = new Request('http://localhost:3000/api/analytics/remark-tags', {
      method: 'GET',
    });

    const res = await analyticsGET(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  // 3. TA is rejected with HTTP 403
  it('3. rejects TA with HTTP 403 Forbidden', async () => {
    mockSessionUser = { id: taId.toString(), role: UserRole.TA, email: 'ta@test.com' };

    const req = new Request('http://localhost:3000/api/analytics/remark-tags', {
      method: 'GET',
    });

    const res = await analyticsGET(req);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.message).toContain('Only professors');
  });

  // 4. Professor sees counts across all their own exams when no exam param is given
  it('4. aggregates tag usage counts across all exams owned by the professor', async () => {
    // Grade on Exam A1 (tagGood, tagMethod)
    await Grade.create({
      answerScript: scriptA1._id,
      rubric: rubricA1Id,
      gradedBy: taId,
      question: 1,
      marksAwarded: [{ criterionName: 'C1', score: 8 }],
      totalScore: 8,
      feedback: 'First review',
      tagIds: [tagGood._id, tagMethod._id],
    });

    // Grade on Exam A2 (tagGood)
    await Grade.create({
      answerScript: scriptA2._id,
      rubric: rubricA2Id,
      gradedBy: taId,
      question: 1,
      marksAwarded: [{ criterionName: 'C1', score: 9 }],
      totalScore: 9,
      feedback: 'Second review',
      tagIds: [tagGood._id],
    });

    const results = await remarkAnalyticsService.getTagUsageAnalytics({
      professorId: profAId.toString(),
    });

    expect(results).toHaveLength(2);
    // tagGood was used in both exams (count: 2)
    const goodEntry = results.find((r) => r.tagId === tagGood._id.toString());
    expect(goodEntry).toBeDefined();
    expect(goodEntry?.label).toBe('Good explanation');
    expect(goodEntry?.count).toBe(2);

    // tagMethod was used in Exam A1 (count: 1)
    const methodEntry = results.find((r) => r.tagId === tagMethod._id.toString());
    expect(methodEntry).toBeDefined();
    expect(methodEntry?.label).toBe('Optimal Method');
    expect(methodEntry?.count).toBe(1);
  });

  // 5. Professor A cannot see Professor B's exam analytics (strict data isolation)
  it('5. strictly isolates data: Professor A cannot see tags from Professor B exams', async () => {
    // Grade for Prof B exam referencing tagProfBOnly and tagGood
    await Grade.create({
      answerScript: scriptB1._id,
      rubric: rubricB1Id,
      gradedBy: taId,
      question: 1,
      marksAwarded: [{ criterionName: 'C1', score: 7 }],
      totalScore: 7,
      feedback: 'Prof B grading',
      tagIds: [tagProfBOnly._id, tagGood._id],
    });

    // Prof A queries analytics
    const resultsProfA = await remarkAnalyticsService.getTagUsageAnalytics({
      professorId: profAId.toString(),
    });

    // Prof A has no graded scripts on their exams yet, so result must be empty
    expect(resultsProfA).toEqual([]);

    // Prof B queries analytics
    const resultsProfB = await remarkAnalyticsService.getTagUsageAnalytics({
      professorId: profBId.toString(),
    });

    expect(resultsProfB).toHaveLength(2);
    expect(resultsProfB.some((r) => r.tagId === tagProfBOnly._id.toString())).toBe(true);
  });

  // 6. Explicit exam filter works for an exam owned by the professor
  it('6. filters analytics to a specific exam when ?exam=<examId> is provided', async () => {
    // Grade on Exam A1 (tagGood)
    await Grade.create({
      answerScript: scriptA1._id,
      rubric: rubricA1Id,
      gradedBy: taId,
      question: 1,
      marksAwarded: [{ criterionName: 'C1', score: 10 }],
      totalScore: 10,
      tagIds: [tagGood._id],
    });

    // Grade on Exam A2 (tagEdge)
    await Grade.create({
      answerScript: scriptA2._id,
      rubric: rubricA2Id,
      gradedBy: taId,
      question: 1,
      marksAwarded: [{ criterionName: 'C1', score: 5 }],
      totalScore: 5,
      tagIds: [tagEdge._id],
    });

    mockSessionUser = { id: profAId.toString(), role: UserRole.PROFESSOR, email: 'profa@test.com' };

    const req = new Request(
      `http://localhost:3000/api/analytics/remark-tags?exam=${examA1Id}`,
      { method: 'GET' }
    );

    const res = await analyticsGET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(1);
    expect(json.data[0].tagId).toBe(tagGood._id.toString());
    expect(json.data[0].count).toBe(1);
  });

  // 7. Explicit exam belonging to another professor is rejected with HTTP 403
  it('7. rejects explicit exam filter belonging to another professor with HTTP 403', async () => {
    mockSessionUser = { id: profAId.toString(), role: UserRole.PROFESSOR, email: 'profa@test.com' };

    // Prof A attempts to query exam belonging to Prof B
    const req = new Request(
      `http://localhost:3000/api/analytics/remark-tags?exam=${examB1Id}`,
      { method: 'GET' }
    );

    const res = await analyticsGET(req);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.message).toContain('Forbidden');
  });

  // 8. Multiple grades referencing the same tag produce correct aggregated count
  it('8. calculates exact count when multiple grades reference the same tag', async () => {
    // Create 3 grades referencing tagGood
    for (let i = 1; i <= 3; i++) {
      await Grade.create({
        answerScript: scriptA1._id,
        rubric: rubricA1Id,
        gradedBy: taId,
        question: i,
        marksAwarded: [{ criterionName: 'C1', score: 8 }],
        totalScore: 8,
        tagIds: [tagGood._id],
      });
    }

    const results = await remarkAnalyticsService.getTagUsageAnalytics({
      professorId: profAId.toString(),
      examId: examA1Id.toString(),
    });

    expect(results).toHaveLength(1);
    expect(results[0].tagId).toBe(tagGood._id.toString());
    expect(results[0].count).toBe(3);
  });

  // 9. Different tags produce independent usage counts
  it('9. calculates independent counts for distinct preset tags', async () => {
    // Grade 1: tagGood, tagMethod
    await Grade.create({
      answerScript: scriptA1._id,
      rubric: rubricA1Id,
      gradedBy: taId,
      question: 1,
      marksAwarded: [{ criterionName: 'C1', score: 9 }],
      totalScore: 9,
      tagIds: [tagGood._id, tagMethod._id],
    });

    // Grade 2: tagGood, tagEdge
    await Grade.create({
      answerScript: scriptA1._id,
      rubric: rubricA1Id,
      gradedBy: taId,
      question: 2,
      marksAwarded: [{ criterionName: 'C1', score: 6 }],
      totalScore: 6,
      tagIds: [tagGood._id, tagEdge._id],
    });

    const results = await remarkAnalyticsService.getTagUsageAnalytics({
      professorId: profAId.toString(),
      examId: examA1Id.toString(),
    });

    expect(results).toHaveLength(3);
    const countsMap = new Map(results.map((r) => [r.label, r.count]));
    expect(countsMap.get('Good explanation')).toBe(2);
    expect(countsMap.get('Optimal Method')).toBe(1);
    expect(countsMap.get('Missing edge cases')).toBe(1);
  });

  // 10. Analytics counts structured tag references (tagIds), NOT text occurrences in Grade.feedback
  it('10. counts structured tag references (tagIds), NOT text occurrences in Grade.feedback', async () => {
    // Grade with feedback mentioning "Good explanation" text, but tagIds is EMPTY
    await Grade.create({
      answerScript: scriptA1._id,
      rubric: rubricA1Id,
      gradedBy: taId,
      question: 1,
      marksAwarded: [{ criterionName: 'C1', score: 10 }],
      totalScore: 10,
      feedback: 'Good explanation and Optimal Method were written in the answer.',
      tagIds: [],
    });

    // Grade with actual tagMethod in tagIds, but different feedback text
    await Grade.create({
      answerScript: scriptA1._id,
      rubric: rubricA1Id,
      gradedBy: taId,
      question: 2,
      marksAwarded: [{ criterionName: 'C1', score: 9 }],
      totalScore: 9,
      feedback: 'Completely unrelated custom text.',
      tagIds: [tagMethod._id],
    });

    const results = await remarkAnalyticsService.getTagUsageAnalytics({
      professorId: profAId.toString(),
      examId: examA1Id.toString(),
    });

    // Should only contain tagMethod (count: 1); "Good explanation" text in feedback must NOT be counted
    expect(results).toHaveLength(1);
    expect(results[0].tagId).toBe(tagMethod._id.toString());
    expect(results[0].label).toBe('Optimal Method');
    expect(results[0].count).toBe(1);
  });

  // 11. Renamed tag dynamically resolves to the current tag label
  it('11. dynamically resolves current tag label when a tag has been renamed', async () => {
    // Persist grade referencing tagGood
    await Grade.create({
      answerScript: scriptA1._id,
      rubric: rubricA1Id,
      gradedBy: taId,
      question: 1,
      marksAwarded: [{ criterionName: 'C1', score: 10 }],
      totalScore: 10,
      tagIds: [tagGood._id],
    });

    // Rename tagGood in database
    tagGood.label = 'Thorough & Rigorous Proof';
    await tagGood.save();

    const results = await remarkAnalyticsService.getTagUsageAnalytics({
      professorId: profAId.toString(),
    });

    expect(results).toHaveLength(1);
    expect(results[0].tagId).toBe(tagGood._id.toString());
    expect(results[0].label).toBe('Thorough & Rigorous Proof');
    expect(results[0].count).toBe(1);
  });

  // 12. Missing / deleted tag reference does not crash the analytics response
  it('12. handles missing/deleted tag gracefully with fallback label without crashing', async () => {
    const deletedTagId = new mongoose.Types.ObjectId();

    await Grade.create({
      answerScript: scriptA1._id,
      rubric: rubricA1Id,
      gradedBy: taId,
      question: 1,
      marksAwarded: [{ criterionName: 'C1', score: 8 }],
      totalScore: 8,
      tagIds: [deletedTagId, tagGood._id],
    });

    const results = await remarkAnalyticsService.getTagUsageAnalytics({
      professorId: profAId.toString(),
    });

    expect(results).toHaveLength(2);
    const deletedResult = results.find((r) => r.tagId === deletedTagId.toString());
    expect(deletedResult).toBeDefined();
    expect(deletedResult?.label).toBe('Unknown Tag');
    expect(deletedResult?.count).toBe(1);

    const goodResult = results.find((r) => r.tagId === tagGood._id.toString());
    expect(goodResult).toBeDefined();
    expect(goodResult?.count).toBe(1);
  });

  // 13. Invalid exam ID parameter returns HTTP 400
  it('13. returns HTTP 400 when invalid examId format is supplied', async () => {
    mockSessionUser = { id: profAId.toString(), role: UserRole.PROFESSOR, email: 'profa@test.com' };

    const req = new Request(
      'http://localhost:3000/api/analytics/remark-tags?exam=invalid-exam-id-123',
      { method: 'GET' }
    );

    const res = await analyticsGET(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.message).toContain('Invalid Exam ID');
  });
});

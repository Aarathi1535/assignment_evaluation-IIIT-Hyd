/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import mongoose from 'mongoose';
import Course from '../models/Course';
import Exam from '../models/Exam';
import CommentTag, { TagScope } from '../models/CommentTag';
import AuditLog from '../models/AuditLog';
import commentTagService from '../services/CommentTagService';
import { UserRole } from '../constants/permissions';
import { HttpError } from '../lib/errors';

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

describe('AE-146: Preset Comment Tags (Service & API)', () => {
  let tagsGET: any;
  let tagsPOST: any;
  let tagDetailGET: any;
  let tagDetailPUT: any;
  let tagDetailDELETE: any;
  let examTagsGET: any;
  let examTagsPOST: any;

  let professorAId: mongoose.Types.ObjectId;
  let professorBId: mongoose.Types.ObjectId;
  let taId: mongoose.Types.ObjectId;
  let otherTaId: mongoose.Types.ObjectId;

  let courseAId: mongoose.Types.ObjectId;
  let examAId: mongoose.Types.ObjectId;

  let courseBId: mongoose.Types.ObjectId;
  let examBId: mongoose.Types.ObjectId;

  beforeAll(async () => {
    tagsGET = (await import('../app/api/tags/route')).GET;
    tagsPOST = (await import('../app/api/tags/route')).POST;
    tagDetailGET = (await import('../app/api/tags/[id]/route')).GET;
    tagDetailPUT = (await import('../app/api/tags/[id]/route')).PUT;
    tagDetailDELETE = (await import('../app/api/tags/[id]/route')).DELETE;
    examTagsGET = (await import('../app/api/exams/[id]/tags/route')).GET;
    examTagsPOST = (await import('../app/api/exams/[id]/tags/route')).POST;
  });

  beforeEach(async () => {
    professorAId = new mongoose.Types.ObjectId('000000000000000000000301');
    professorBId = new mongoose.Types.ObjectId('000000000000000000000302');
    taId = new mongoose.Types.ObjectId('000000000000000000000303');
    otherTaId = new mongoose.Types.ObjectId('000000000000000000000304');

    // Course & Exam owned by Professor A (TA assigned)
    const courseA = new Course({
      courseCode: 'CS101',
      courseName: 'Intro to CS',
      semester: 1,
      academicYear: '2026-2027',
      professor: professorAId,
      teachingAssistants: [taId],
      enrolledStudents: [],
      isActive: true,
    });
    const savedCourseA = await courseA.save();
    courseAId = savedCourseA._id as mongoose.Types.ObjectId;

    const examA = new Exam({
      title: 'CS101 Midterm',
      course: courseAId,
      createdBy: professorAId,
      examDate: new Date('2026-10-15T09:00:00.000Z'),
      totalMarks: 50,
      numberOfQuestions: 2,
      status: 'PUBLISHED',
      isActive: true,
    });
    const savedExamA = await examA.save();
    examAId = savedExamA._id as mongoose.Types.ObjectId;

    // Course & Exam owned by Professor B
    const courseB = new Course({
      courseCode: 'CS202',
      courseName: 'Data Structures',
      semester: 1,
      academicYear: '2026-2027',
      professor: professorBId,
      teachingAssistants: [otherTaId],
      enrolledStudents: [],
      isActive: true,
    });
    const savedCourseB = await courseB.save();
    courseBId = savedCourseB._id as mongoose.Types.ObjectId;

    const examB = new Exam({
      title: 'CS202 Midterm',
      course: courseBId,
      createdBy: professorBId,
      examDate: new Date('2026-10-15T09:00:00.000Z'),
      totalMarks: 50,
      numberOfQuestions: 2,
      status: 'PUBLISHED',
      isActive: true,
    });
    const savedExamB = await examB.save();
    examBId = savedExamB._id as mongoose.Types.ObjectId;
  });

  afterEach(async () => {
    await Course.deleteMany({});
    await Exam.deleteMany({});
    await CommentTag.deleteMany({});
    await AuditLog.deleteMany({});
    mockSessionUser = null;
  });

  // 1. Professor can create GLOBAL tag
  it('1. allows Professor to create a GLOBAL tag and writes an audit log', async () => {
    const tag = await commentTagService.createTag(
      {
        label: 'Missing Base Case',
        scope: TagScope.GLOBAL,
        description: 'Recursive solution lacks termination condition',
      },
      {
        userId: professorAId.toString(),
        userRole: UserRole.PROFESSOR,
      }
    );

    expect(tag).toBeDefined();
    expect(tag.label).toBe('Missing Base Case');
    expect(tag.scope).toBe(TagScope.GLOBAL);
    expect(tag.exam).toBeNull();
    expect(tag.createdBy.toString()).toBe(professorAId.toString());

    // Check audit log
    const auditLogs = await AuditLog.find({ entityId: tag._id, entityType: 'CommentTag' });
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0].action).toBe('TAG_CREATED');
    expect(auditLogs[0].outcome).toBe('SUCCESS');
  });

  // 2. Professor can create EXAM tag for their own exam
  it('2. allows Professor to create an EXAM tag for their own exam', async () => {
    const tag = await commentTagService.createTag(
      {
        label: 'Heap Invariant Violated',
        scope: TagScope.EXAM,
        examId: examAId.toString(),
        description: 'Binary heap min-property not maintained',
      },
      {
        userId: professorAId.toString(),
        userRole: UserRole.PROFESSOR,
      }
    );

    expect(tag).toBeDefined();
    expect(tag.label).toBe('Heap Invariant Violated');
    expect(tag.scope).toBe(TagScope.EXAM);
    expect(tag.exam?.toString()).toBe(examAId.toString());
  });

  // 3. Professor cannot create/manage EXAM tag for another professor's exam
  it('3. rejects Professor creating or managing tags for another professor’s exam', async () => {
    // Professor A attempts to create a tag on Professor B's exam
    await expect(
      commentTagService.createTag(
        {
          label: 'Unauthorized Tag',
          scope: TagScope.EXAM,
          examId: examBId.toString(),
        },
        {
          userId: professorAId.toString(),
          userRole: UserRole.PROFESSOR,
        }
      )
    ).rejects.toThrow('Forbidden: You do not have permission to create tags for this exam');

    // Professor B creates a tag on Exam B
    const tagB = await commentTagService.createTag(
      {
        label: 'Graph Cycle',
        scope: TagScope.EXAM,
        examId: examBId.toString(),
      },
      {
        userId: professorBId.toString(),
        userRole: UserRole.PROFESSOR,
      }
    );

    // Professor A attempts to update Professor B's tag
    await expect(
      commentTagService.updateTag(
        tagB._id.toString(),
        { label: 'Hacked Label' },
        {
          userId: professorAId.toString(),
          userRole: UserRole.PROFESSOR,
        }
      )
    ).rejects.toThrow('Forbidden: You do not have permission to modify tags for this exam');

    // Professor A attempts to delete Professor B's tag
    await expect(
      commentTagService.deleteTag(tagB._id.toString(), {
        userId: professorAId.toString(),
        userRole: UserRole.PROFESSOR,
      })
    ).rejects.toThrow('Forbidden: You do not have permission to delete tags for this exam');
  });

  // 4. TA can list/read available tags
  it('4. allows TA to list global tags and tags for assigned exams', async () => {
    // Seed global tag
    await commentTagService.createTag(
      { label: 'Off-by-one Error', scope: TagScope.GLOBAL },
      { userId: professorAId.toString(), userRole: UserRole.PROFESSOR }
    );

    // Seed Exam A tag
    await commentTagService.createTag(
      { label: 'CS101 Specific Tag', scope: TagScope.EXAM, examId: examAId.toString() },
      { userId: professorAId.toString(), userRole: UserRole.PROFESSOR }
    );

    // TA lists tags for Exam A
    const tagsForExamA = await commentTagService.listTags({
      examId: examAId.toString(),
      userId: taId.toString(),
      userRole: UserRole.TA,
    });

    expect(tagsForExamA).toHaveLength(2);
    const labels = tagsForExamA.map((t) => t.label);
    expect(labels).toContain('Off-by-one Error');
    expect(labels).toContain('CS101 Specific Tag');
  });

  // 5. TA cannot create/update/delete tags
  it('5. rejects TA attempts to create, update, or delete tags', async () => {
    // TA attempts create
    await expect(
      commentTagService.createTag(
        { label: 'TA Created Tag', scope: TagScope.GLOBAL },
        { userId: taId.toString(), userRole: UserRole.TA }
      )
    ).rejects.toThrow('Forbidden: Only professors and admins can create comment tags');

    // Seed a tag
    const tag = await commentTagService.createTag(
      { label: 'Global Tag', scope: TagScope.GLOBAL },
      { userId: professorAId.toString(), userRole: UserRole.PROFESSOR }
    );

    // TA attempts update
    await expect(
      commentTagService.updateTag(
        tag._id.toString(),
        { label: 'TA Updated' },
        { userId: taId.toString(), userRole: UserRole.TA }
      )
    ).rejects.toThrow('Forbidden: Only professors and admins can update comment tags');

    // TA attempts delete
    await expect(
      commentTagService.deleteTag(tag._id.toString(), {
        userId: taId.toString(),
        userRole: UserRole.TA,
      })
    ).rejects.toThrow('Forbidden: Only professors and admins can delete comment tags');
  });

  // 6. Global + exam-specific tags returned for an exam
  it('6. returns both global and exam-specific tags when querying for an exam', async () => {
    await commentTagService.createTag(
      { label: 'Global Tag 1', scope: TagScope.GLOBAL },
      { userId: professorAId.toString(), userRole: UserRole.PROFESSOR }
    );
    await commentTagService.createTag(
      { label: 'Exam A Tag 1', scope: TagScope.EXAM, examId: examAId.toString() },
      { userId: professorAId.toString(), userRole: UserRole.PROFESSOR }
    );

    const tags = await commentTagService.listTags({
      examId: examAId.toString(),
      userId: professorAId.toString(),
      userRole: UserRole.PROFESSOR,
    });

    expect(tags).toHaveLength(2);
    expect(tags.some((t) => t.scope === TagScope.GLOBAL)).toBe(true);
    expect(tags.some((t) => t.scope === TagScope.EXAM)).toBe(true);
  });

  // 7. Another professor's exam tags are not leaked
  it('7. ensures another professor’s exam tags are not returned', async () => {
    // Tag for Exam A (Prof A)
    await commentTagService.createTag(
      { label: 'Exam A Private Tag', scope: TagScope.EXAM, examId: examAId.toString() },
      { userId: professorAId.toString(), userRole: UserRole.PROFESSOR }
    );

    // Tag for Exam B (Prof B)
    await commentTagService.createTag(
      { label: 'Exam B Private Tag', scope: TagScope.EXAM, examId: examBId.toString() },
      { userId: professorBId.toString(), userRole: UserRole.PROFESSOR }
    );

    // Prof A lists all their tags (no examId filter)
    const profATags = await commentTagService.listTags({
      userId: professorAId.toString(),
      userRole: UserRole.PROFESSOR,
    });

    const labelsA = profATags.map((t) => t.label);
    expect(labelsA).toContain('Exam A Private Tag');
    expect(labelsA).not.toContain('Exam B Private Tag');
  });

  // 8. Duplicate GLOBAL label rejected
  it('8. rejects duplicate GLOBAL tag labels with HTTP 409', async () => {
    await commentTagService.createTag(
      { label: 'Clean Code', scope: TagScope.GLOBAL },
      { userId: professorAId.toString(), userRole: UserRole.PROFESSOR }
    );

    await expect(
      commentTagService.createTag(
        { label: '  clean code  ', scope: TagScope.GLOBAL },
        { userId: professorBId.toString(), userRole: UserRole.PROFESSOR }
      )
    ).rejects.toThrow('A global tag with label "clean code" already exists');
  });

  // 9. Duplicate EXAM label within same exam rejected
  it('9. rejects duplicate EXAM tag labels within the same exam with HTTP 409', async () => {
    await commentTagService.createTag(
      { label: 'Corner Case Missed', scope: TagScope.EXAM, examId: examAId.toString() },
      { userId: professorAId.toString(), userRole: UserRole.PROFESSOR }
    );

    await expect(
      commentTagService.createTag(
        { label: 'Corner Case Missed', scope: TagScope.EXAM, examId: examAId.toString() },
        { userId: professorAId.toString(), userRole: UserRole.PROFESSOR }
      )
    ).rejects.toThrow('already exists for this exam');
  });

  // 10. Same label GLOBAL vs EXAM is allowed
  it('10. allows the same label in GLOBAL scope and EXAM scope, and across different exams', async () => {
    const globalTag = await commentTagService.createTag(
      { label: 'Incorrect Complexity', scope: TagScope.GLOBAL },
      { userId: professorAId.toString(), userRole: UserRole.PROFESSOR }
    );

    const examATag = await commentTagService.createTag(
      { label: 'Incorrect Complexity', scope: TagScope.EXAM, examId: examAId.toString() },
      { userId: professorAId.toString(), userRole: UserRole.PROFESSOR }
    );

    const examBTag = await commentTagService.createTag(
      { label: 'Incorrect Complexity', scope: TagScope.EXAM, examId: examBId.toString() },
      { userId: professorBId.toString(), userRole: UserRole.PROFESSOR }
    );

    expect(globalTag._id.toString()).not.toBe(examATag._id.toString());
    expect(examATag._id.toString()).not.toBe(examBTag._id.toString());
  });

  // 11. Invalid/empty label rejected
  it('11. rejects invalid/empty labels', async () => {
    await expect(
      commentTagService.createTag(
        { label: '   ', scope: TagScope.GLOBAL },
        { userId: professorAId.toString(), userRole: UserRole.PROFESSOR }
      )
    ).rejects.toThrow(HttpError);
  });

  // 12. EXAM tag without valid exam rejected
  it('12. rejects EXAM-scoped tag creation without valid exam reference', async () => {
    await expect(
      commentTagService.createTag(
        { label: 'No Exam Tag', scope: TagScope.EXAM, examId: null },
        { userId: professorAId.toString(), userRole: UserRole.PROFESSOR }
      )
    ).rejects.toThrow('Valid Exam ID is required for EXAM-scoped tags');
  });

  // 13. Update and delete mutations are audit-logged
  it('13. logs audit entries on update and delete mutations', async () => {
    const tag = await commentTagService.createTag(
      { label: 'Initial Tag', scope: TagScope.GLOBAL },
      { userId: professorAId.toString(), userRole: UserRole.PROFESSOR }
    );

    await commentTagService.updateTag(
      tag._id.toString(),
      { label: 'Renamed Tag', description: 'Updated note' },
      { userId: professorAId.toString(), userRole: UserRole.PROFESSOR }
    );

    const updateLogs = await AuditLog.find({ entityId: tag._id, action: 'TAG_UPDATED' });
    expect(updateLogs).toHaveLength(1);

    await commentTagService.deleteTag(tag._id.toString(), {
      userId: professorAId.toString(),
      userRole: UserRole.PROFESSOR,
    });

    const deleteLogs = await AuditLog.find({ entityId: tag._id, action: 'TAG_DELETED' });
    expect(deleteLogs).toHaveLength(1);
  });

  // 14. API Routes Integration: GET /api/tags, POST /api/tags, PUT /api/tags/[id], DELETE /api/tags/[id]
  it('14. integrates end-to-end with /api/tags and /api/tags/[id] HTTP endpoints', async () => {
    mockSessionUser = {
      id: professorAId.toString(),
      name: 'Professor A',
      email: 'profA@example.com',
      role: UserRole.PROFESSOR,
    };

    // 1. POST /api/tags
    const createReq = new Request('http://localhost:3000/api/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: 'HTTP Global Tag',
        scope: 'GLOBAL',
        description: 'Created via HTTP POST',
      }),
    });

    const createRes = await tagsPOST(createReq);
    expect(createRes.status).toBe(201);
    const createdJson = await createRes.json();
    expect(createdJson.success).toBe(true);
    const createdId = createdJson.data._id;

    // 2. GET /api/tags
    const listReq = new Request('http://localhost:3000/api/tags');
    const listRes = await tagsGET(listReq);
    expect(listRes.status).toBe(200);
    const listJson = await listRes.json();
    expect(listJson.data.some((t: any) => t._id === createdId)).toBe(true);

    // 3. GET /api/tags/[id]
    const getReq = new Request(`http://localhost:3000/api/tags/${createdId}`);
    const getRes = await tagDetailGET(getReq, { params: Promise.resolve({ id: createdId }) });
    expect(getRes.status).toBe(200);
    const getJson = await getRes.json();
    expect(getJson.data.label).toBe('HTTP Global Tag');

    // 4. PUT /api/tags/[id]
    const putReq = new Request(`http://localhost:3000/api/tags/${createdId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: 'HTTP Global Tag Updated',
      }),
    });
    const putRes = await tagDetailPUT(putReq, { params: Promise.resolve({ id: createdId }) });
    expect(putRes.status).toBe(200);

    // 5. DELETE /api/tags/[id]
    const delReq = new Request(`http://localhost:3000/api/tags/${createdId}`, {
      method: 'DELETE',
    });
    const delRes = await tagDetailDELETE(delReq, { params: Promise.resolve({ id: createdId }) });
    expect(delRes.status).toBe(200);

    // 6. Verify deleted
    const checkReq = new Request(`http://localhost:3000/api/tags/${createdId}`);
    const checkRes = await tagDetailGET(checkReq, { params: Promise.resolve({ id: createdId }) });
    expect(checkRes.status).toBe(404);
  });

  // 15. API Routes Integration: GET & POST /api/exams/[id]/tags
  it('15. integrates end-to-end with /api/exams/[id]/tags', async () => {
    mockSessionUser = {
      id: professorAId.toString(),
      name: 'Professor A',
      email: 'profA@example.com',
      role: UserRole.PROFESSOR,
    };

    const postReq = new Request(`http://localhost:3000/api/exams/${examAId}/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: 'Exam A Specific Chip',
      }),
    });

    const postRes = await examTagsPOST(postReq, { params: Promise.resolve({ id: examAId.toString() }) });
    expect(postRes.status).toBe(201);

    const getReq = new Request(`http://localhost:3000/api/exams/${examAId}/tags`);
    const getRes = await examTagsGET(getReq, { params: Promise.resolve({ id: examAId.toString() }) });
    expect(getRes.status).toBe(200);
    const getJson = await getRes.json();
    expect(getJson.data.some((t: any) => t.label === 'Exam A Specific Chip')).toBe(true);
  });
});

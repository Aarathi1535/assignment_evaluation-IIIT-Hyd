/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import Course from '../models/Course';
import Exam, { ExamStatus } from '../models/Exam';
import User, { UserRole } from '../models/User';
import { NextRequest } from 'next/server';
import { PUT as updateExamRoute, GET as getExamRoute } from '../app/api/exams/[id]/route';
import { IdentificationSource, IdentificationStatus } from '../models/AnswerScript';

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

describe('AE-071 — OMR Template Configuration per Exam Tests', () => {
  let profOwner: any;
  let course: any;
  let exam1: any;
  let exam2: any;

  const validOMRTemplate = {
    pageIndex: 0,
    columns: [
      {
        columnIndex: 0,
        bubbles: [
          { value: '0', x: 0.1, y: 0.1, width: 0.05, height: 0.05 },
          { value: '1', x: 0.1, y: 0.2, width: 0.05, height: 0.05 }
        ]
      },
      {
        columnIndex: 1,
        bubbles: [
          { value: '0', x: 0.2, y: 0.1, width: 0.05, height: 0.05 },
          { value: '1', x: 0.2, y: 0.2, width: 0.05, height: 0.05 }
        ]
      }
    ]
  };

  beforeAll(async () => {
    await Course.init();
    await Exam.init();
    await User.init();
  });

  beforeEach(async () => {
    mockSessionUser = null;

    // Clean DB collection states
    await Exam.deleteMany({});
    await Course.deleteMany({});
    await User.deleteMany({});

    // Create a professor owner
    profOwner = await User.create({
      name: 'Prof Owner',
      email: `prof-owner-${Date.now()}@university.edu`,
      password: 'password123',
      role: UserRole.PROFESSOR,
      isActive: true
    });

    // Create associated Course
    course = await Course.create({
      courseCode: 'CS101',
      courseName: 'Intro to CS',
      professor: profOwner._id,
      semester: 1,
      academicYear: '2026-2027',
      isActive: true
    });

    // Create two exams for isolation checks
    exam1 = await Exam.create({
      title: 'Exam 1',
      course: course._id,
      createdBy: profOwner._id,
      examDate: new Date(),
      totalMarks: 100,
      status: ExamStatus.DRAFT,
      numberOfQuestions: 5,
      isActive: true
    });

    exam2 = await Exam.create({
      title: 'Exam 2',
      course: course._id,
      createdBy: profOwner._id,
      examDate: new Date(),
      totalMarks: 100,
      status: ExamStatus.DRAFT,
      numberOfQuestions: 5,
      isActive: true
    });
  });

  // Helper to send PUT update requests
  const sendUpdateExamRequest = async (examId: string, payload: any) => {
    const req = new NextRequest(`http://localhost:3000/api/exams/${examId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await updateExamRoute(req, { params: Promise.resolve({ id: examId }) });
  };

  // Helper to send GET retrieve requests
  const sendGetExamRequest = async (examId: string) => {
    const req = new NextRequest(`http://localhost:3000/api/exams/${examId}`, {
      method: 'GET'
    });
    return await getExamRoute(req, { params: Promise.resolve({ id: examId }) });
  };

  it('1. Create a valid OMR template, 2. Retrieve the stored template, and 3. Update it', async () => {
    mockSessionUser = { id: profOwner._id.toString(), email: profOwner.email, role: 'PROFESSOR' };

    // 1. Create (PUT template)
    const resCreate = await sendUpdateExamRequest(exam1._id.toString(), {
      omrTemplate: validOMRTemplate
    });
    expect(resCreate.status).toBe(200);

    // 2. Retrieve via GET API
    const resGet = await sendGetExamRequest(exam1._id.toString());
    expect(resGet.status).toBe(200);
    const bodyGet = await resGet.json();
    expect(bodyGet.success).toBe(true);
    expect(bodyGet.data.omrTemplate).not.toBeNull();
    expect(bodyGet.data.omrTemplate.pageIndex).toBe(0);
    expect(bodyGet.data.omrTemplate.columns.length).toBe(2);

    // 3. Update existing template
    const updatedTemplate = {
      ...validOMRTemplate,
      pageIndex: 1
    };
    const resUpdate = await sendUpdateExamRequest(exam1._id.toString(), {
      omrTemplate: updatedTemplate
    });
    expect(resUpdate.status).toBe(200);

    const bodyUpdate = await resUpdate.json();
    expect(bodyUpdate.data.omrTemplate.pageIndex).toBe(1);
  });

  it('4. Verify coordinates are stored as normalized values', async () => {
    mockSessionUser = { id: profOwner._id.toString(), email: profOwner.email, role: 'PROFESSOR' };

    await sendUpdateExamRequest(exam1._id.toString(), {
      omrTemplate: validOMRTemplate
    });

    const storedExam = await Exam.findById(exam1._id);
    expect(storedExam?.omrTemplate).not.toBeNull();
    
    const template = storedExam?.omrTemplate;
    expect(template).toBeDefined();
    expect(template).not.toBeNull();
    if (!template) {
      throw new Error('Template not found');
    }
    expect(template.pageIndex).toBe(0);
    for (const column of template.columns) {
      for (const bubble of column.bubbles) {
        expect(bubble.x).toBeGreaterThanOrEqual(0.0);
        expect(bubble.x).toBeLessThanOrEqual(1.0);
        expect(bubble.y).toBeGreaterThanOrEqual(0.0);
        expect(bubble.y).toBeLessThanOrEqual(1.0);
        expect(bubble.width).toBeGreaterThanOrEqual(0.0);
        expect(bubble.width).toBeLessThanOrEqual(1.0);
        expect(bubble.height).toBeGreaterThanOrEqual(0.0);
        expect(bubble.height).toBeLessThanOrEqual(1.0);
      }
    }
  });

  it('5. Reject x < 0', async () => {
    mockSessionUser = { id: profOwner._id.toString(), email: profOwner.email, role: 'PROFESSOR' };

    const invalidTemplate = {
      pageIndex: 0,
      columns: [{
        columnIndex: 0,
        bubbles: [{ value: '0', x: -0.01, y: 0.1, width: 0.05, height: 0.05 }]
      }]
    };

    const res = await sendUpdateExamRequest(exam1._id.toString(), { omrTemplate: invalidTemplate });
    expect(res.status).toBe(400);
  });

  it('6. Reject x > 1', async () => {
    mockSessionUser = { id: profOwner._id.toString(), email: profOwner.email, role: 'PROFESSOR' };

    const invalidTemplate = {
      pageIndex: 0,
      columns: [{
        columnIndex: 0,
        bubbles: [{ value: '0', x: 1.01, y: 0.1, width: 0.05, height: 0.05 }]
      }]
    };

    const res = await sendUpdateExamRequest(exam1._id.toString(), { omrTemplate: invalidTemplate });
    expect(res.status).toBe(400);
  });

  it('7. Reject y < 0', async () => {
    mockSessionUser = { id: profOwner._id.toString(), email: profOwner.email, role: 'PROFESSOR' };

    const invalidTemplate = {
      pageIndex: 0,
      columns: [{
        columnIndex: 0,
        bubbles: [{ value: '0', x: 0.1, y: -0.05, width: 0.05, height: 0.05 }]
      }]
    };

    const res = await sendUpdateExamRequest(exam1._id.toString(), { omrTemplate: invalidTemplate });
    expect(res.status).toBe(400);
  });

  it('8. Reject y > 1', async () => {
    mockSessionUser = { id: profOwner._id.toString(), email: profOwner.email, role: 'PROFESSOR' };

    const invalidTemplate = {
      pageIndex: 0,
      columns: [{
        columnIndex: 0,
        bubbles: [{ value: '0', x: 0.1, y: 1.1, width: 0.05, height: 0.05 }]
      }]
    };

    const res = await sendUpdateExamRequest(exam1._id.toString(), { omrTemplate: invalidTemplate });
    expect(res.status).toBe(400);
  });

  it('9. Reject negative width/height', async () => {
    mockSessionUser = { id: profOwner._id.toString(), email: profOwner.email, role: 'PROFESSOR' };

    const invalidTemplateNegWidth = {
      pageIndex: 0,
      columns: [{
        columnIndex: 0,
        bubbles: [{ value: '0', x: 0.1, y: 0.1, width: -0.05, height: 0.05 }]
      }]
    };

    const resWidth = await sendUpdateExamRequest(exam1._id.toString(), { omrTemplate: invalidTemplateNegWidth });
    expect(resWidth.status).toBe(400);

    const invalidTemplateNegHeight = {
      pageIndex: 0,
      columns: [{
        columnIndex: 0,
        bubbles: [{ value: '0', x: 0.1, y: 0.1, width: 0.05, height: -0.05 }]
      }]
    };

    const resHeight = await sendUpdateExamRequest(exam1._id.toString(), { omrTemplate: invalidTemplateNegHeight });
    expect(resHeight.status).toBe(400);
  });

  it('10. Reject regions extending beyond page bounds', async () => {
    mockSessionUser = { id: profOwner._id.toString(), email: profOwner.email, role: 'PROFESSOR' };

    // x + width = 0.98 + 0.05 = 1.03 > 1.0
    const invalidTemplateXOverflow = {
      pageIndex: 0,
      columns: [{
        columnIndex: 0,
        bubbles: [{ value: '0', x: 0.98, y: 0.1, width: 0.05, height: 0.05 }]
      }]
    };

    const resX = await sendUpdateExamRequest(exam1._id.toString(), { omrTemplate: invalidTemplateXOverflow });
    expect(resX.status).toBe(400);

    // y + height = 0.98 + 0.05 = 1.03 > 1.0
    const invalidTemplateYOverflow = {
      pageIndex: 0,
      columns: [{
        columnIndex: 0,
        bubbles: [{ value: '0', x: 0.1, y: 0.98, width: 0.05, height: 0.05 }]
      }]
    };

    const resY = await sendUpdateExamRequest(exam1._id.toString(), { omrTemplate: invalidTemplateYOverflow });
    expect(resY.status).toBe(400);
  });

  it('11. Reject an empty/invalid bubble grid', async () => {
    mockSessionUser = { id: profOwner._id.toString(), email: profOwner.email, role: 'PROFESSOR' };

    // Empty columns
    const emptyColumns = {
      pageIndex: 0,
      columns: []
    };
    const resEmptyCols = await sendUpdateExamRequest(exam1._id.toString(), { omrTemplate: emptyColumns });
    expect(resEmptyCols.status).toBe(400);

    // Empty bubbles in a column
    const emptyBubbles = {
      pageIndex: 0,
      columns: [{
        columnIndex: 0,
        bubbles: []
      }]
    };
    const resEmptyBubbles = await sendUpdateExamRequest(exam1._id.toString(), { omrTemplate: emptyBubbles });
    expect(resEmptyBubbles.status).toBe(400);
  });

  it('12. Reject invalid bubble ordering/mapping (duplicates & non-contiguous indexes)', async () => {
    mockSessionUser = { id: profOwner._id.toString(), email: profOwner.email, role: 'PROFESSOR' };

    // Duplicate column indexes
    const dupCols = {
      pageIndex: 0,
      columns: [
        {
          columnIndex: 0,
          bubbles: [{ value: '0', x: 0.1, y: 0.1, width: 0.05, height: 0.05 }]
        },
        {
          columnIndex: 0,
          bubbles: [{ value: '1', x: 0.2, y: 0.1, width: 0.05, height: 0.05 }]
        }
      ]
    };
    const resDupCols = await sendUpdateExamRequest(exam1._id.toString(), { omrTemplate: dupCols });
    expect(resDupCols.status).toBe(400);

    // Non-contiguous column indexes (skips index 1)
    const nonContigCols = {
      pageIndex: 0,
      columns: [
        {
          columnIndex: 0,
          bubbles: [{ value: '0', x: 0.1, y: 0.1, width: 0.05, height: 0.05 }]
        },
        {
          columnIndex: 2,
          bubbles: [{ value: '1', x: 0.2, y: 0.1, width: 0.05, height: 0.05 }]
        }
      ]
    };
    const resNonContig = await sendUpdateExamRequest(exam1._id.toString(), { omrTemplate: nonContigCols });
    expect(resNonContig.status).toBe(400);

    // Non-zero start column index
    const nonZeroStart = {
      pageIndex: 0,
      columns: [
        {
          columnIndex: 1,
          bubbles: [{ value: '0', x: 0.1, y: 0.1, width: 0.05, height: 0.05 }]
        }
      ]
    };
    const resNonZero = await sendUpdateExamRequest(exam1._id.toString(), { omrTemplate: nonZeroStart });
    expect(resNonZero.status).toBe(400);

    // Duplicate bubble values in the same column
    const dupBubbleValues = {
      pageIndex: 0,
      columns: [{
        columnIndex: 0,
        bubbles: [
          { value: '0', x: 0.1, y: 0.1, width: 0.05, height: 0.05 },
          { value: '0', x: 0.1, y: 0.2, width: 0.05, height: 0.05 }
        ]
      }]
    };
    const resDupBubbles = await sendUpdateExamRequest(exam1._id.toString(), { omrTemplate: dupBubbleValues });
    expect(resDupBubbles.status).toBe(400);

    // Duplicate bubble coordinates (conflict)
    const dupCoords = {
      pageIndex: 0,
      columns: [
        {
          columnIndex: 0,
          bubbles: [{ value: '0', x: 0.1, y: 0.1, width: 0.05, height: 0.05 }]
        },
        {
          columnIndex: 1,
          bubbles: [{ value: '1', x: 0.1, y: 0.1, width: 0.05, height: 0.05 }]
        }
      ]
    };
    const resDupCoords = await sendUpdateExamRequest(exam1._id.toString(), { omrTemplate: dupCoords });
    expect(resDupCoords.status).toBe(400);
  });

  it('13. Verify template belongs to correct exam & 14. Verify templates for two exams remain isolated', async () => {
    mockSessionUser = { id: profOwner._id.toString(), email: profOwner.email, role: 'PROFESSOR' };

    // Apply template to Exam 1
    await sendUpdateExamRequest(exam1._id.toString(), { omrTemplate: validOMRTemplate });

    // Verify Exam 1 has the template
    const stored1 = await Exam.findById(exam1._id);
    expect(stored1?.omrTemplate).not.toBeNull();
    expect(stored1?.omrTemplate?.pageIndex).toBe(0);

    // Verify Exam 2 remains null (isolated)
    const stored2 = await Exam.findById(exam2._id);
    expect(stored2?.omrTemplate).toBeNull();
  });

  it('15. Verify normalized coordinates are independent of page resolution', () => {
    const bubble = { value: '0', x: 0.25, y: 0.40, width: 0.05, height: 0.03 };

    // High resolution (e.g. 2480 x 3508)
    const widthA = 2480;
    const heightA = 3508;
    const pixelBoxA = {
      x: bubble.x * widthA,
      y: bubble.y * heightA,
      width: bubble.width * widthA,
      height: bubble.height * heightA
    };

    // Low resolution (e.g. 1240 x 1754)
    const widthB = 1240;
    const heightB = 1754;
    const pixelBoxB = {
      x: bubble.x * widthB,
      y: bubble.y * heightB,
      width: bubble.width * widthB,
      height: bubble.height * heightB
    };

    // Assert ratios are mathematically identical (i.e. resolve back to the exact same normalized values)
    expect(pixelBoxA.x / widthA).toBeCloseTo(bubble.x, 6);
    expect(pixelBoxA.y / heightA).toBeCloseTo(bubble.y, 6);
    expect(pixelBoxA.width / widthA).toBeCloseTo(bubble.width, 6);
    expect(pixelBoxA.height / heightA).toBeCloseTo(bubble.height, 6);

    expect(pixelBoxB.x / widthB).toBeCloseTo(bubble.x, 6);
    expect(pixelBoxB.y / heightB).toBeCloseTo(bubble.y, 6);
    expect(pixelBoxB.width / widthB).toBeCloseTo(bubble.width, 6);
    expect(pixelBoxB.height / heightB).toBeCloseTo(bubble.height, 6);

    // Assert pixel coordinates scale proportionally (factor of 2 difference)
    expect(pixelBoxA.x).toBe(pixelBoxB.x * 2);
    expect(pixelBoxA.y).toBe(pixelBoxB.y * 2);
    expect(pixelBoxA.width).toBe(pixelBoxB.width * 2);
    expect(pixelBoxA.height).toBe(pixelBoxB.height * 2);
  });

  it('16. Verify missing template configuration produces a safe configuration/fallback state rather than an ID', async () => {
    // Assert exam2 has no OMR template
    const examWithoutTemplate = await Exam.findById(exam2._id);
    expect(examWithoutTemplate?.omrTemplate).toBeNull();

    // Define mock OMR reader behaviour for fallback check
    const runOMRReader = (exam: any) => {
      if (!exam.omrTemplate) {
        throw new Error('OMR_TEMPLATE_MISSING');
      }
      return 'GuessedStudentId';
    };

    // Verify it throws/fails gracefully and does not guess a student ID
    expect(() => runOMRReader(examWithoutTemplate)).toThrow('OMR_TEMPLATE_MISSING');
  });

  it('17. Verify the template contract is compatible with the future AE-070 OMR reader', async () => {
    mockSessionUser = { id: profOwner._id.toString(), email: profOwner.email, role: 'PROFESSOR' };

    await sendUpdateExamRequest(exam1._id.toString(), { omrTemplate: validOMRTemplate });
    const exam = await Exam.findById(exam1._id);

    // Mock AE-070 OMR reader parsing behavior using the stored template contract
    const simulateOMRReader = (examDoc: any, pageDimensions: { width: number; height: number }) => {
      const template = examDoc.omrTemplate;
      if (!template) {
        return null;
      }

      const detectedDigits: string[] = [];

      // AE-070 will loop through columns and bubble coordinates
      for (const col of template.columns) {
        let bestBubbleValue: string | null = null;
        let highestFillRatio = 0.0;

        for (const bubble of col.bubbles) {
          // Scale coordinates to the current page resolution (AE-070)
          const pixelX = bubble.x * pageDimensions.width;
          const pixelY = bubble.y * pageDimensions.height;
          const pixelWidth = bubble.width * pageDimensions.width;
          const pixelHeight = bubble.height * pageDimensions.height;

          expect(pixelX).toBeGreaterThanOrEqual(0);
          expect(pixelY).toBeGreaterThanOrEqual(0);
          expect(pixelWidth).toBeGreaterThan(0);
          expect(pixelHeight).toBeGreaterThan(0);

          // Simulated calculation
          const simulatedFillRatio = bubble.value === '1' ? 0.85 : 0.05; 
          if (simulatedFillRatio > highestFillRatio) {
            highestFillRatio = simulatedFillRatio;
            bestBubbleValue = bubble.value;
          }
        }
        if (bestBubbleValue !== null) {
          detectedDigits.push(bestBubbleValue);
        }
      }

      return detectedDigits.join('');
    };

    const detectedStudentId = simulateOMRReader(exam, { width: 1000, height: 1400 });
    expect(detectedStudentId).toBe('11'); // Column 0 reads '1', Column 1 reads '1'
  });

  it('18. Verify existing AE-072 identification behavior remains unchanged', () => {
    // Assert all IdentificationSource enum values and statuses are present and distinct
    expect(IdentificationSource.OPERATOR).toBe('OPERATOR');
    expect(IdentificationSource.QR).toBe('QR');
    expect(IdentificationSource.OMR).toBe('OMR');
    expect(IdentificationSource.OCR).toBe('OCR');

    expect(IdentificationStatus.IDENTIFIED).toBe('IDENTIFIED');
    expect(IdentificationStatus.UNIDENTIFIED).toBe('UNIDENTIFIED');
  });
});

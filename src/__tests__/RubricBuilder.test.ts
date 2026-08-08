import { describe, it, expect } from 'vitest';
import { validateRubricClient, Question } from '../utils/rubricBuilderUtils';

describe('Rubric Builder Client Validation Tests (AE-039)', () => {

  it('should fail validation if questions list is empty', () => {
    const errors = validateRubricClient([]);
    expect(errors).toContain('At least one question is required.');
  });

  it('should fail validation if question number is negative or zero', () => {
    const invalidQuestions: Question[] = [
      {
        questionNumber: 0,
        maxMarks: 10,
        criteria: [{ criterionName: 'Logic', points: 10 }]
      }
    ];
    const errors = validateRubricClient(invalidQuestions);
    expect(errors.some(e => e.includes('Question number must be a positive integer'))).toBe(true);
  });

  it('should fail validation if question max marks is negative or zero', () => {
    const invalidQuestions: Question[] = [
      {
        questionNumber: 1,
        maxMarks: -5,
        criteria: [{ criterionName: 'Logic', points: 10 }]
      }
    ];
    const errors = validateRubricClient(invalidQuestions);
    expect(errors.some(e => e.includes('Max marks must be a positive number'))).toBe(true);
  });

  it('should fail validation if a criterion name is empty', () => {
    const invalidQuestions: Question[] = [
      {
        questionNumber: 1,
        maxMarks: 10,
        criteria: [{ criterionName: '   ', points: 10 }]
      }
    ];
    const errors = validateRubricClient(invalidQuestions);
    expect(errors.some(e => e.includes('Name is required'))).toBe(true);
  });

  it('should fail validation if a criterion points value is negative or zero', () => {
    const invalidQuestions: Question[] = [
      {
        questionNumber: 1,
        maxMarks: 10,
        criteria: [{ criterionName: 'Logic', points: -2 }]
      }
    ];
    const errors = validateRubricClient(invalidQuestions);
    expect(errors.some(e => e.includes('Points must be a positive number'))).toBe(true);
  });

  it('should fail validation if there are duplicate question numbers', () => {
    const duplicateQuestions: Question[] = [
      {
        questionNumber: 1,
        maxMarks: 10,
        criteria: [{ criterionName: 'Logic', points: 10 }]
      },
      {
        questionNumber: 1,
        maxMarks: 15,
        criteria: [{ criterionName: 'Correctness', points: 15 }]
      }
    ];
    const errors = validateRubricClient(duplicateQuestions);
    expect(errors).toContain('Duplicate question numbers are not allowed.');
  });

  it('should fail validation if sum of criteria points exceeds question max marks', () => {
    const invalidQuestions: Question[] = [
      {
        questionNumber: 1,
        maxMarks: 10,
        criteria: [
          { criterionName: 'Logic', points: 8 },
          { criterionName: 'Style', points: 4 } // sum is 12, maxMarks is 10
        ]
      }
    ];
    const errors = validateRubricClient(invalidQuestions);
    expect(errors.some(e => e.includes('cannot exceed maximum marks'))).toBe(true);
  });

  it('should validate a correct questions structure successfully with no errors', () => {
    const validQuestions: Question[] = [
      {
        questionNumber: 1,
        maxMarks: 20,
        criteria: [
          { criterionName: 'Logic', description: 'Logical steps', points: 15 },
          { criterionName: 'Formatting', points: 5 }
        ]
      },
      {
        questionNumber: 2,
        maxMarks: 10,
        criteria: [
          { criterionName: 'Complexity analysis', points: 10 }
        ]
      }
    ];
    const errors = validateRubricClient(validQuestions);
    expect(errors.length).toBe(0);
  });
});

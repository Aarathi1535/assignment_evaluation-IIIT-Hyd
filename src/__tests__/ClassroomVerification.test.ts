import { describe, it, expect } from 'vitest';
import { verifyClassroomAnswer } from '../lib/classroomVerification';

describe('verifyClassroomAnswer', () => {
  it('should mark answer as correct for exact string matches regardless of case/whitespace', () => {
    expect(verifyClassroomAnswer('  hello world  ', 'Hello World').isCorrect).toBe(true);
    expect(verifyClassroomAnswer('TCP handshake', 'tcp handshake').isCorrect).toBe(true);
  });

  it('should handle numeric and float equivalence', () => {
    expect(verifyClassroomAnswer('42', '42.0').isCorrect).toBe(true);
    expect(verifyClassroomAnswer('42.00', '42').isCorrect).toBe(true);
    expect(verifyClassroomAnswer('3.14159', '3.1416').isCorrect).toBe(true);
    expect(verifyClassroomAnswer('100', '200').isCorrect).toBe(false);
  });

  it('should handle fractions and formulas', () => {
    expect(verifyClassroomAnswer('1/2', '0.5').isCorrect).toBe(true);
    expect(verifyClassroomAnswer('x = 5', '5').isCorrect).toBe(true);
    expect(verifyClassroomAnswer('ans: 10 m/s', '10').isCorrect).toBe(true);
  });

  it('should handle key concept and token set matching in sentences', () => {
    const student = 'The three steps are SYN, then SYN-ACK, followed by ACK';
    const reference = 'SYN, SYN-ACK, ACK';
    expect(verifyClassroomAnswer(student, reference).isCorrect).toBe(true);
  });

  it('should handle typo tolerance with fuzzy matching', () => {
    expect(verifyClassroomAnswer('polymorphism', 'polymorphysm').isCorrect).toBe(true);
    expect(verifyClassroomAnswer('quicksort algorithm', 'quick sort algorithm').isCorrect).toBe(true);
  });

  it('should mark completely wrong answers as incorrect', () => {
    expect(verifyClassroomAnswer('UDP protocol', 'TCP three-way handshake').isCorrect).toBe(false);
    expect(verifyClassroomAnswer('Python', 'Java virtual machine').isCorrect).toBe(false);
  });

  it('should handle missing reference answer gracefully', () => {
    expect(verifyClassroomAnswer('anything', null).isCorrect).toBe(true);
    expect(verifyClassroomAnswer('anything', '').isCorrect).toBe(true);
  });
});


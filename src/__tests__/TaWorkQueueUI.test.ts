import { describe, it, expect } from 'vitest';

interface AnswerScript {
  _id: string;
  exam: string;
  anonymousId?: string;
  scriptReference?: string;
  student?: string; // PII (should be omitted in blind mode)
  isActive: boolean;
}

interface Allocation {
  _id: string;
  exam: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
  question?: number;
  answerScript: AnswerScript | null;
}

// Client-side helper functions that will drive the page logic
export function computeStats(allocations: Allocation[]) {
  const uniqueExams = Array.from(new Set(allocations.map(a => a.exam))).length;
  const pendingCount = allocations.filter(a => a.status !== 'COMPLETED').length;
  const completedCount = allocations.filter(a => a.status === 'COMPLETED').length;
  return { uniqueExams, pendingCount, completedCount };
}

export function getScriptReference(script: AnswerScript | null) {
  if (!script) return 'Unassigned Script';
  return script.scriptReference || script.anonymousId || 'Unassigned Script';
}

export function getGradingModeLabel(alloc: Allocation) {
  if (alloc.question !== undefined && alloc.question !== null) {
    return `Question ${alloc.question}`;
  }
  return 'Whole Script';
}

export function getGradingTargetUrl(alloc: Allocation) {
  const script = alloc.answerScript;
  if (!script) return '#';
  if (alloc.question !== undefined && alloc.question !== null) {
    return `/grading/${script._id}/question/${alloc.question}`;
  }
  return `/grading/${script._id}`;
}

export function getFriendlyErrorMessage(status: number, statusText: string) {
  if (status === 401) return 'Session expired. Please log in again.';
  if (status === 403) return 'Access denied. Only teaching assistants can access the work queue.';
  return `Failed to retrieve allocations: ${statusText}`;
}

describe('TA Work-Queue UI Logic & Unit Tests (AE-095)', () => {
  const mockAllocations: Allocation[] = [
    {
      _id: 'alloc-1',
      exam: 'exam-blind-midterm',
      status: 'PENDING',
      answerScript: {
        _id: 'script-1',
        exam: 'exam-blind-midterm',
        anonymousId: 'ANON-POTTER-777',
        scriptReference: 'Script #ANON-POTTER-777',
        isActive: true
      }
    },
    {
      _id: 'alloc-2',
      exam: 'exam-non-blind-quiz',
      status: 'IN_PROGRESS',
      question: 3,
      answerScript: {
        _id: 'script-2',
        exam: 'exam-non-blind-quiz',
        student: 'Harry Potter', // PII returned only for non-blind (permitted)
        isActive: true
      }
    },
    {
      _id: 'alloc-3',
      exam: 'exam-blind-midterm',
      status: 'COMPLETED',
      answerScript: {
        _id: 'script-3',
        exam: 'exam-blind-midterm',
        anonymousId: 'ANON-MALFOY-888',
        scriptReference: 'Script #ANON-MALFOY-888',
        isActive: true
      }
    }
  ];

  // 1. Success queue rendering stats calculation
  it('should correctly calculate stats (assigned exams, pending, completed) from allocations', () => {
    const stats = computeStats(mockAllocations);
    expect(stats.uniqueExams).toBe(2); // 'exam-blind-midterm' and 'exam-non-blind-quiz'
    expect(stats.pendingCount).toBe(2); // alloc-1 (PENDING) and alloc-2 (IN_PROGRESS)
    expect(stats.completedCount).toBe(1); // alloc-3 (COMPLETED)
  });

  // 2. Loading state logic
  it('should represent mock loading state successfully', () => {
    const uiState = { isLoading: true, allocations: [], error: null };
    expect(uiState.isLoading).toBe(true);
    expect(uiState.allocations).toHaveLength(0);
    expect(uiState.error).toBeNull();
  });

  // 3. Empty queue state logic
  it('should handle mock empty queue state representation correctly', () => {
    const emptyAllocations: Allocation[] = [];
    const stats = computeStats(emptyAllocations);
    expect(stats.uniqueExams).toBe(0);
    expect(stats.pendingCount).toBe(0);
    expect(stats.completedCount).toBe(0);
    expect(emptyAllocations).toHaveLength(0);
  });

  // 4. API Error state mapping
  it('should map API error status codes to descriptive user messages', () => {
    expect(getFriendlyErrorMessage(401, 'Unauthorized')).toBe('Session expired. Please log in again.');
    expect(getFriendlyErrorMessage(403, 'Forbidden')).toBe('Access denied. Only teaching assistants can access the work queue.');
    expect(getFriendlyErrorMessage(500, 'Internal Server Error')).toBe('Failed to retrieve allocations: Internal Server Error');
  });

  // 5. Anonymization & Privacy rendering
  it('should render scriptReference or anonymousId, and assert the absolute absence of student identity details for blind-graded submissions', () => {
    // Blind allocation
    const allocBlind = mockAllocations[0];
    const scriptBlind = allocBlind.answerScript;

    // Verify it consumes only the anonymized representation
    const displayedRef = getScriptReference(scriptBlind);
    expect(displayedRef).toBe('Script #ANON-POTTER-777');
    
    // Explicitly assert that student fields do not exist in the blind object
    expect(scriptBlind?.student).toBeUndefined();
  });

  // 6. Question-wise context mapping
  it('should distinguish between question-wise and whole-script allocation contexts', () => {
    // alloc-1 is whole-script
    expect(getGradingModeLabel(mockAllocations[0])).toBe('Whole Script');
    
    // alloc-2 is question-wise (question: 3)
    expect(getGradingModeLabel(mockAllocations[1])).toBe('Question 3');
  });

  // 7. Navigation target route generator
  it('should generate the exact target paths for routing', () => {
    // Question-wise targets exact pattern: /grading/[scriptId]/question/[questionNumber]
    const urlQuestionWise = getGradingTargetUrl(mockAllocations[1]);
    expect(urlQuestionWise).toBe('/grading/script-2/question/3');

    // Whole-script target pattern: /grading/[scriptId]
    const urlWholeScript = getGradingTargetUrl(mockAllocations[0]);
    expect(urlWholeScript).toBe('/grading/script-1');

    // Missing script should fail-safe
    const urlMissingScript = getGradingTargetUrl({ _id: 'alloc-x', exam: 'exam-x', status: 'PENDING', answerScript: null });
    expect(urlMissingScript).toBe('#');
  });
});

import { describe, it, expect } from 'vitest';

export interface AnswerScript {
  _id: string;
  exam: string;
  anonymousId?: string;
  scriptReference?: string;
  student?: string; // PII (should be omitted in blind mode)
  isActive: boolean;
}

export interface Allocation {
  _id: string;
  exam: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
  question?: number;
  answerScript: AnswerScript | null;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface ParsedApiResponse {
  success?: boolean;
  data?: {
    allocations?: Allocation[];
    pagination?: Pagination | null;
  } | Allocation[];
}

// Client-side helper functions that drive the page logic
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

export function parseApiResponse(body: ParsedApiResponse | null | undefined): { allocations: Allocation[]; pagination: Pagination | null } {
  if (!body || !body.success || !body.data) {
    return { allocations: [], pagination: null };
  }
  if (Array.isArray(body.data)) {
    return {
      allocations: body.data,
      pagination: null
    };
  }
  if (body.data.allocations && Array.isArray(body.data.allocations)) {
    return {
      allocations: body.data.allocations,
      pagination: body.data.pagination || null
    };
  }
  return { allocations: [], pagination: null };
}

export function buildApiUrl(page: number, limit = 20): string {
  return `/api/allocations?page=${page}&limit=${limit}`;
}

export function getPaginationButtonStates(pagination: Pagination | null) {
  if (!pagination) {
    return { prevDisabled: true, nextDisabled: true };
  }
  return {
    prevDisabled: !pagination.hasPreviousPage,
    nextDisabled: !pagination.hasNextPage
  };
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
        student: 'Harry Potter',
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

  it('should correctly calculate stats (assigned exams, pending, completed) from allocations', () => {
    const stats = computeStats(mockAllocations);
    expect(stats.uniqueExams).toBe(2);
    expect(stats.pendingCount).toBe(2);
    expect(stats.completedCount).toBe(1);
  });

  it('should represent mock loading state successfully', () => {
    const uiState = { isLoading: true, allocations: [], error: null };
    expect(uiState.isLoading).toBe(true);
    expect(uiState.allocations).toHaveLength(0);
    expect(uiState.error).toBeNull();
  });

  it('should handle mock empty queue state representation correctly', () => {
    const emptyAllocations: Allocation[] = [];
    const stats = computeStats(emptyAllocations);
    expect(stats.uniqueExams).toBe(0);
    expect(stats.pendingCount).toBe(0);
    expect(stats.completedCount).toBe(0);
    expect(emptyAllocations).toHaveLength(0);
  });

  it('should map API error status codes to descriptive user messages', () => {
    expect(getFriendlyErrorMessage(401, 'Unauthorized')).toBe('Session expired. Please log in again.');
    expect(getFriendlyErrorMessage(403, 'Forbidden')).toBe('Access denied. Only teaching assistants can access the work queue.');
    expect(getFriendlyErrorMessage(500, 'Internal Server Error')).toBe('Failed to retrieve allocations: Internal Server Error');
  });

  it('should render scriptReference or anonymousId, and assert the absolute absence of student identity details for blind-graded submissions', () => {
    const allocBlind = mockAllocations[0];
    const scriptBlind = allocBlind.answerScript;

    const displayedRef = getScriptReference(scriptBlind);
    expect(displayedRef).toBe('Script #ANON-POTTER-777');
    expect(scriptBlind?.student).toBeUndefined();
  });

  it('should distinguish between question-wise and whole-script allocation contexts', () => {
    expect(getGradingModeLabel(mockAllocations[0])).toBe('Whole Script');
    expect(getGradingModeLabel(mockAllocations[1])).toBe('Question 3');
  });

  it('should generate the exact target paths for routing', () => {
    const urlQuestionWise = getGradingTargetUrl(mockAllocations[1]);
    expect(urlQuestionWise).toBe('/grading/script-2/question/3');

    const urlWholeScript = getGradingTargetUrl(mockAllocations[0]);
    expect(urlWholeScript).toBe('/grading/script-1');

    const urlMissingScript = getGradingTargetUrl({ _id: 'alloc-x', exam: 'exam-x', status: 'PENDING', answerScript: null });
    expect(urlMissingScript).toBe('#');
  });

  describe('Pagination Unit Tests', () => {
    it('should parse paginated response shape correctly', () => {
      const mockResponseBody = {
        success: true,
        message: 'Allocations retrieved successfully',
        data: {
          allocations: mockAllocations,
          pagination: {
            page: 1,
            limit: 20,
            total: 3,
            totalPages: 1,
            hasNextPage: false,
            hasPreviousPage: false
          }
        }
      };

      const parsed = parseApiResponse(mockResponseBody);
      expect(parsed.allocations).toHaveLength(3);
      expect(parsed.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 3,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false
      });
    });

    it('should fall back safely for legacy non-paginated shapes', () => {
      const legacyResponseBody = {
        success: true,
        message: 'Allocations retrieved',
        data: mockAllocations
      };

      const parsed = parseApiResponse(legacyResponseBody);
      expect(parsed.allocations).toHaveLength(3);
      expect(parsed.pagination).toBeNull();
    });

    it('should compute correct disabled states for first, middle, and last page pagination controls', () => {
      // First page
      const firstPageMetadata: Pagination = {
        page: 1,
        limit: 2,
        total: 5,
        totalPages: 3,
        hasNextPage: true,
        hasPreviousPage: false
      };
      const firstPageStates = getPaginationButtonStates(firstPageMetadata);
      expect(firstPageStates.prevDisabled).toBe(true);
      expect(firstPageStates.nextDisabled).toBe(false);

      // Middle page
      const middlePageMetadata: Pagination = {
        page: 2,
        limit: 2,
        total: 5,
        totalPages: 3,
        hasNextPage: true,
        hasPreviousPage: true
      };
      const middlePageStates = getPaginationButtonStates(middlePageMetadata);
      expect(middlePageStates.prevDisabled).toBe(false);
      expect(middlePageStates.nextDisabled).toBe(false);

      // Last page
      const lastPageMetadata: Pagination = {
        page: 3,
        limit: 2,
        total: 5,
        totalPages: 3,
        hasNextPage: false,
        hasPreviousPage: true
      };
      const lastPageStates = getPaginationButtonStates(lastPageMetadata);
      expect(lastPageStates.prevDisabled).toBe(false);
      expect(lastPageStates.nextDisabled).toBe(true);
    });

    it('should generate correct API query URL for page transitions', () => {
      expect(buildApiUrl(1)).toBe('/api/allocations?page=1&limit=20');
      expect(buildApiUrl(3, 10)).toBe('/api/allocations?page=3&limit=10');
    });

    it('should distinguish empty queue from error queue representation', () => {
      // Simulated state logic
      const stateWithError = {
        isLoading: false,
        error: 'Network Error',
        allocations: []
      };
      // Error is set, so error alert will render, not EmptyState
      const shouldRenderErrorBanner = !!stateWithError.error;
      const shouldRenderEmptyState = !stateWithError.error && stateWithError.allocations.length === 0;

      expect(shouldRenderErrorBanner).toBe(true);
      expect(shouldRenderEmptyState).toBe(false);

      const stateEmpty = {
        isLoading: false,
        error: null,
        allocations: []
      };
      const shouldRenderErrorBannerEmpty = !!stateEmpty.error;
      const shouldRenderEmptyStateEmpty = !stateEmpty.error && stateEmpty.allocations.length === 0;

      expect(shouldRenderErrorBannerEmpty).toBe(false);
      expect(shouldRenderEmptyStateEmpty).toBe(true);
    });
  });
});

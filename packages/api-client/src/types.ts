/**
 * RFC 7807 Problem Details for HTTP APIs
 */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
  invalidParams?: Array<{ name: string; reason: string }>;
  [key: string]: unknown;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    requestId?: string;
    timestamp?: string;
  };
}

export interface ClientConfig {
  baseUrl: string;
  authToken?: string;
  apiKey?: string;
  timeoutMs?: number;
  maxRetries?: number;
  defaultHeaders?: Record<string, string>;
}

// Classroom Data Types
export interface ClassroomSession {
  id: string;
  sessionCode: string;
  title: string;
  courseCode: string;
  status: 'SCHEDULED' | 'ACTIVE' | 'CLOSED' | 'ARCHIVED';
  activeQuestionId?: string;
  participantCount: number;
  submissionCount: number;
  durationMinutes: number;
  createdAt: string;
  expiresAt?: string;
}

export interface ClassroomActivity {
  id: string;
  sessionId: string;
  title: string;
  activityType: 'MCQ_POLL' | 'WORD_CLOUD' | 'HANDWRITTEN_ANSWER' | 'OPEN_TEXT' | 'NUMERIC' | 'RATING';
  prompt: string;
  options?: string[];
  durationSeconds: number;
  status: 'DRAFT' | 'ACTIVE' | 'CLOSED' | 'RESULTS_PUBLISHED';
  revealedToStudents: boolean;
  maxPoints?: number;
}

export interface ClassroomResponseSubmission {
  activityId: string;
  studentIdentifier: string;
  studentName: string;
  responseType: string;
  selectedOptionIndex?: number;
  textResponse?: string;
  numericResponse?: number;
  imageUrl?: string;
}

export interface ClassroomAggregateTally {
  activityId: string;
  activityType: string;
  totalResponses: number;
  distribution: Record<string, number>;
  averageScore?: number;
  isRevealed: boolean;
}

// Practice Data Types
export interface TopicNode {
  id: string;
  code: string;
  name: string;
  description?: string;
  unitCode: string;
  prerequisites: string[];
  learningObjectives: string[];
}

export interface PracticeQuestion {
  id: string;
  courseCode: string;
  topicCode: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  questionType: 'conceptual' | 'analytical' | 'numerical' | 'coding' | 'debugging' | 'code_completion' | 'output_prediction';
  questionText: string;
  options?: string[];
  referenceAnswer?: string; // Stripped in student view
  hints: string[];
  maxScore: number;
  status: 'DRAFT_GENERATED' | 'APPROVED' | 'ARCHIVED';
}

export interface PracticeSubmissionResult {
  questionId: string;
  isCorrect: boolean;
  score: number;
  feedback: string;
  nextRecommendedDifficulty?: 'EASY' | 'MEDIUM' | 'HARD';
  conceptMasteryScore: number;
}

// Evaluation Data Types
export interface ExamDetails {
  id: string;
  courseCode: string;
  title: string;
  totalMarks: number;
  status: 'DRAFT' | 'PUBLISHED' | 'GRADING' | 'COMPLETED' | 'RESULTS_RELEASED';
  submissionsCount: number;
  gradedCount: number;
}

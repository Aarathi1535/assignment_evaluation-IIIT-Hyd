import { BaseApiClient } from './base';
import {
  TopicNode,
  PracticeQuestion,
  PracticeSubmissionResult,
  ApiResponse,
  ClientConfig,
} from './types';

export class PracticeApiClient extends BaseApiClient {
  constructor(config?: Partial<ClientConfig>) {
    super({
      baseUrl: config?.baseUrl || process.env.PRACTICE_SERVICE_URL || 'http://localhost:3002/api/v1/practice',
      authToken: config?.authToken,
      apiKey: config?.apiKey,
      timeoutMs: config?.timeoutMs,
      maxRetries: config?.maxRetries,
    });
  }

  public async getHealth(): Promise<{ status: string; uptime: number }> {
    return this.request<{ status: string; uptime: number }>('/health');
  }

  public async getTaxonomy(courseCode: string): Promise<ApiResponse<{ courseCode: string; topics: TopicNode[] }>> {
    return this.request<ApiResponse<{ courseCode: string; topics: TopicNode[] }>>(`/taxonomy/${courseCode}`);
  }

  public async getQuestions(params: {
    courseCode: string;
    topicCode?: string;
    difficulty?: string;
    type?: string;
  }): Promise<ApiResponse<PracticeQuestion[]>> {
    return this.request<ApiResponse<PracticeQuestion[]>>('/questions', {
      query: params,
    });
  }

  public async getDailyPractice(courseCode: string): Promise<ApiResponse<{ questions: PracticeQuestion[]; date: string }>> {
    return this.request<ApiResponse<{ questions: PracticeQuestion[]; date: string }>>('/daily', {
      query: { courseCode },
    });
  }

  public async submitPracticeAnswer(data: {
    questionId: string;
    answerText: string;
    selectedOptionIndex?: number;
    timeSpentSeconds: number;
  }): Promise<ApiResponse<PracticeSubmissionResult>> {
    return this.request<ApiResponse<PracticeSubmissionResult>>('/submissions', {
      method: 'POST',
      body: data,
    });
  }

  public async generateQuestionsAI(params: {
    courseCode: string;
    topicCode: string;
    count: number;
    difficultyDistribution?: { EASY: number; MEDIUM: number; HARD: number };
  }): Promise<ApiResponse<PracticeQuestion[]>> {
    return this.request<ApiResponse<PracticeQuestion[]>>('/questions/generate', {
      method: 'POST',
      body: params,
    });
  }

  public async approveQuestion(questionId: string): Promise<ApiResponse<PracticeQuestion>> {
    return this.request<ApiResponse<PracticeQuestion>>(`/questions/${questionId}/approve`, {
      method: 'PATCH',
    });
  }
}

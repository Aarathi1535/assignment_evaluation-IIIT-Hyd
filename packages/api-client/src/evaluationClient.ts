import { BaseApiClient } from './base';
import { ExamDetails, ApiResponse, ClientConfig } from './types';

export class EvaluationApiClient extends BaseApiClient {
  constructor(config?: Partial<ClientConfig>) {
    super({
      baseUrl: config?.baseUrl || process.env.EVALUATION_SERVICE_URL || 'http://localhost:3000/api/v1/evaluation',
      authToken: config?.authToken,
      apiKey: config?.apiKey,
      timeoutMs: config?.timeoutMs,
      maxRetries: config?.maxRetries,
    });
  }

  public async getHealth(): Promise<{ status: string; uptime: number }> {
    return this.request<{ status: string; uptime: number }>('/health');
  }

  public async listExams(courseCode?: string): Promise<ApiResponse<ExamDetails[]>> {
    return this.request<ApiResponse<ExamDetails[]>>('/exams', {
      query: { courseCode },
    });
  }

  public async getExamById(examId: string): Promise<ApiResponse<ExamDetails>> {
    return this.request<ApiResponse<ExamDetails>>(`/exams/${examId}`);
  }
}

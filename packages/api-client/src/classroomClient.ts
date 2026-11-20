import { BaseApiClient } from './base';
import {
  ClassroomSession,
  ClassroomActivity,
  ClassroomResponseSubmission,
  ClassroomAggregateTally,
  ApiResponse,
  ClientConfig,
} from './types';

export class ClassroomApiClient extends BaseApiClient {
  constructor(config?: Partial<ClientConfig>) {
    super({
      baseUrl: config?.baseUrl || process.env.CLASSROOM_SERVICE_URL || 'http://localhost:3001/api/v1/classroom',
      authToken: config?.authToken,
      apiKey: config?.apiKey,
      timeoutMs: config?.timeoutMs,
      maxRetries: config?.maxRetries,
    });
  }

  public async getHealth(): Promise<{ status: string; uptime: number }> {
    return this.request<{ status: string; uptime: number }>('/health');
  }

  public async createSession(data: {
    title: string;
    courseCode: string;
    durationMinutes: number;
  }): Promise<ApiResponse<ClassroomSession>> {
    return this.request<ApiResponse<ClassroomSession>>('/sessions', {
      method: 'POST',
      body: data,
    });
  }

  public async listSessions(status?: string): Promise<ApiResponse<ClassroomSession[]>> {
    return this.request<ApiResponse<ClassroomSession[]>>('/sessions', {
      query: { status },
    });
  }

  public async getSessionByCode(sessionCode: string): Promise<ApiResponse<ClassroomSession>> {
    return this.request<ApiResponse<ClassroomSession>>(`/sessions/${sessionCode}`);
  }

  public async joinSession(
    sessionCode: string,
    participant: { studentName: string; rollNumber?: string }
  ): Promise<ApiResponse<{ participantToken: string; session: ClassroomSession }>> {
    return this.request<ApiResponse<{ participantToken: string; session: ClassroomSession }>>(
      `/sessions/${sessionCode}/join`,
      {
        method: 'POST',
        body: participant,
      }
    );
  }

  public async createActivity(
    sessionCode: string,
    activity: {
      title: string;
      activityType: string;
      prompt: string;
      options?: string[];
      durationSeconds: number;
    }
  ): Promise<ApiResponse<ClassroomActivity>> {
    return this.request<ApiResponse<ClassroomActivity>>(`/sessions/${sessionCode}/activities`, {
      method: 'POST',
      body: activity,
    });
  }

  public async transitionActivity(
    activityId: string,
    action: 'START' | 'CLOSE' | 'PUBLISH_RESULTS'
  ): Promise<ApiResponse<ClassroomActivity>> {
    return this.request<ApiResponse<ClassroomActivity>>(`/activities/${activityId}/transition`, {
      method: 'PATCH',
      body: { action },
    });
  }

  public async submitResponse(
    activityId: string,
    submission: ClassroomResponseSubmission
  ): Promise<ApiResponse<{ recordedAt: string; submissionId: string }>> {
    return this.request<ApiResponse<{ recordedAt: string; submissionId: string }>>(
      `/activities/${activityId}/submit`,
      {
        method: 'POST',
        body: submission,
      }
    );
  }

  public async getAggregateTally(activityId: string): Promise<ApiResponse<ClassroomAggregateTally>> {
    return this.request<ApiResponse<ClassroomAggregateTally>>(`/activities/${activityId}/tally`);
  }
}

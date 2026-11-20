import { LtiScorePayload } from './types';

export interface AgsClientConfig {
  lineItemUrl?: string;
  accessToken?: string;
  isStubMode?: boolean;
}

export class LtiAgsService {
  private readonly lineItemUrl?: string;
  private readonly accessToken?: string;
  private readonly isStubMode: boolean;

  constructor(config: AgsClientConfig = {}) {
    this.lineItemUrl = config.lineItemUrl;
    this.accessToken = config.accessToken;
    this.isStubMode =
      config.isStubMode ??
      (process.env.LTI_STUB_MODE === 'true' || process.env.NODE_ENV === 'test');
  }

  /**
   * Publishes a student grade to LMS gradebook via AGS v2.0 scores endpoint.
   */
  public async submitScore(
    score: LtiScorePayload,
    targetUrl?: string
  ): Promise<{ success: boolean; statusCode: number; responseData?: unknown }> {
    const url = targetUrl || (this.lineItemUrl ? `${this.lineItemUrl}/scores` : undefined);

    if (this.isStubMode || !url) {
      // Safe stub mode: validates payload structure and logs without network call
      if (!score.userId || typeof score.scoreGiven !== 'number' || typeof score.scoreMaximum !== 'number') {
        throw new Error('Invalid LTI score payload: userId, scoreGiven, and scoreMaximum are required.');
      }

      return {
        success: true,
        statusCode: 200,
        responseData: {
          stub: true,
          submittedScore: score,
          timestamp: new Date().toISOString(),
        },
      };
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/vnd.ims.lis.v1.score+json',
    };
    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(score),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`LTI AGS grade passback failed (${res.status}): ${errText}`);
    }

    return {
      success: true,
      statusCode: res.status,
    };
  }

  /**
   * Formats a standard score payload from evaluation results.
   */
  public static createScorePayload(params: {
    studentLmsSub: string;
    points: number;
    maxPoints: number;
    comment?: string;
  }): LtiScorePayload {
    return {
      userId: params.studentLmsSub,
      scoreGiven: params.points,
      scoreMaximum: params.maxPoints,
      comment: params.comment || 'Assignment graded on IIIT Hyderabad Learning Platform',
      timestamp: new Date().toISOString(),
      activityProgress: 'Completed',
      gradingProgress: 'FullyGraded',
    };
  }
}

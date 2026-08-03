import { NextResponse } from 'next/server';
import { healthService } from '@/services/HealthService';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const health = await healthService.getHealthStatus();
    const statusCode = health.status === 'healthy' ? 200 : 503;

    return NextResponse.json(
      {
        success: true,
        data: health,
      },
      { status: statusCode }
    );
  } catch {
    return NextResponse.json(
      {
        success: false,
        message: 'Health check failed',
      },
      { status: 500 }
    );
  }
}

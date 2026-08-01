import mongoose from 'mongoose';
import { connectDB } from '@/lib/db';

export interface HealthStatus {
  status: 'healthy' | 'unhealthy';
  database: 'connected' | 'disconnected';
  timestamp: string;
}

class HealthService {
  public async getHealthStatus(): Promise<HealthStatus> {
    if (mongoose.connection.readyState === 0) {
      try {
        await connectDB();
      } catch (error) {
        // Catch connection error so the response can report "unhealthy"/"disconnected" rather than throwing 500
      }
    }

    const isConnected = mongoose.connection.readyState === 1;

    return {
      status: isConnected ? 'healthy' : 'unhealthy',
      database: isConnected ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
    };
  }
}

export const healthService = new HealthService();

import { NextRequest, NextResponse } from 'next/server';
import { AsyncLocalStorage } from 'async_hooks';
import mongoose from 'mongoose';
import { logGraderTiming } from './graderPerformance';

interface TimingStore {
  dbRoundTrips: number;
  dbTimeMs: number;
}

export const timingContext = new AsyncLocalStorage<TimingStore>();

let isMonitoringInitialized = false;

function initMongooseMonitoring() {
  if (isMonitoringInitialized) return;
  
  // Enable command monitoring for the underlying MongoDB driver
  try {
      (mongoose.set as (key: string, val: unknown) => typeof mongoose)('monitorCommands', true);
  } catch (e: unknown) {
      const err = e as Error;
      if (err.name !== 'SetOptionError') throw e;
  }
  
  mongoose.connection.on('commandSucceeded', (event) => {
    const store = timingContext.getStore();
    if (store) {
      store.dbRoundTrips += 1;
      store.dbTimeMs += event.duration;
    }
  });
  
  isMonitoringInitialized = true;
}

export function withServerTiming<T extends unknown[]>(
  handler: (req: NextRequest, ...args: T) => Promise<NextResponse | Response>
) {
  initMongooseMonitoring();

  return async (req: NextRequest, ...args: T) => {
    const start = performance.now();
    const store: TimingStore = { dbRoundTrips: 0, dbTimeMs: 0 };
    
    return timingContext.run(store, async () => {
      let response: Response;
      try {
        response = await handler(req, ...args);
      } catch (error) {
        // Log timing even on unhandled errors, though Next.js error boundary will catch it
        const totalDur = performance.now() - start;
        console.error(`[Server-Timing] Unhandled error, total=${totalDur.toFixed(1)}ms, db=${store.dbTimeMs.toFixed(1)}ms, trips=${store.dbRoundTrips}`);
        throw error;
      }

      const totalDur = performance.now() - start;
      const timingMetrics = [
        `total;dur=${totalDur.toFixed(1)}`,
        `db;dur=${store.dbTimeMs.toFixed(1)}`,
        `db_queries;desc="round_trips_${store.dbRoundTrips}"`
      ];

      const pathname = req?.nextUrl?.pathname ?? (req?.url ? new URL(req.url, 'http://localhost').pathname : '') ?? '';
      logGraderTiming(pathname, start, {
         dbTimeMs: Number(store.dbTimeMs.toFixed(1)),
         dbRoundTrips: store.dbRoundTrips
      });

      // Attempt to mutate the response headers directly, which is safer in Next.js 14+
      try {
        const existingTiming = response.headers.get('Server-Timing');
        if (existingTiming) {
          response.headers.set('Server-Timing', `${existingTiming}, ${timingMetrics.join(', ')}`);
        } else {
          response.headers.set('Server-Timing', timingMetrics.join(', '));
        }
        return response;
      } catch {
        // Fallback if headers are read-only
        const newHeaders = new Headers(response.headers);
        newHeaders.set('Server-Timing', timingMetrics.join(', '));
        return new NextResponse(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders,
        });
      }
    });
  };
}

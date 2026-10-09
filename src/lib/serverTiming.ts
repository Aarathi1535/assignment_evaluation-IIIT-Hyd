import { NextRequest, NextResponse } from 'next/server';
import { AsyncLocalStorage } from 'async_hooks';
import mongoose from 'mongoose';
import { logGraderTiming } from './graderPerformance';

interface TimingStore {
  dbRoundTrips: number;
  dbTimeMs: number;
}

export const timingContext = new AsyncLocalStorage<TimingStore>();

// Track monitored MongoClient instances to avoid duplicate listeners across reconnects
const monitoredClients = new WeakSet<object>();

interface CommandMonitoringEmitter {
  on(event: string, listener: (event: unknown) => void): void;
}

interface CommandMonitoringEvent {
  requestId?: number;
  connectionId?: number | string;
  address?: string;
  duration?: number;
}

const MAX_COMMAND_TTL_MS = 60_000;
const MAX_TRACKED_COMMANDS = 1_000;

function getCommandKey(rawEvent: unknown): string | number | null {
  const event = rawEvent as CommandMonitoringEvent;
  if (!event || typeof event.requestId !== 'number') {
    return null;
  }
  const connId = event.connectionId !== undefined && event.connectionId !== null ? String(event.connectionId) : '';
  const address = typeof event.address === 'string' ? event.address : '';
  if (connId || address) {
    return `${address}#${connId}#${event.requestId}`;
  }
  return event.requestId;
}

/**
 * Attaches command monitoring listeners to the actual MongoDB driver's MongoClient.
 * Safely handles connection instances and prevents duplicate listeners across reconnects.
 */
export function attachCommandMonitoring(client?: unknown) {
  let targetClient: CommandMonitoringEmitter | null = null;
  if (client && typeof (client as CommandMonitoringEmitter).on === 'function') {
    targetClient = client as CommandMonitoringEmitter;
  } else if (mongoose.connection && mongoose.connection.readyState !== 0) {
    try {
      targetClient = mongoose.connection.getClient() as unknown as CommandMonitoringEmitter;
    } catch {
      // Driver client not initialized yet
    }
  }

  if (!targetClient || typeof targetClient.on !== 'function') {
    return;
  }

  if (monitoredClients.has(targetClient)) {
    return;
  }

  // Track in-flight command start times for high-resolution timing measurement on this client
  const commandStartTimes = new Map<string | number, number>();

  const pruneStaleCommands = (now: number) => {
    // 1. Prune expired entries (FIFO order in Map)
    for (const [key, startTime] of commandStartTimes.entries()) {
      if (now - startTime > MAX_COMMAND_TTL_MS) {
        commandStartTimes.delete(key);
      } else {
        break; // Remaining entries are more recent
      }
    }
    // 2. Enforce hard capacity bound
    while (commandStartTimes.size > MAX_TRACKED_COMMANDS) {
      const oldestKey = commandStartTimes.keys().next().value;
      if (oldestKey !== undefined) {
        commandStartTimes.delete(oldestKey);
      } else {
        break;
      }
    }
  };

  const onCommandStarted = (rawEvent: unknown) => {
    const key = getCommandKey(rawEvent);
    if (key !== null) {
      const now = performance.now();
      if (commandStartTimes.size > 100) {
        pruneStaleCommands(now);
      }
      commandStartTimes.set(key, now);
    }
  };

  const onCommandFinished = (rawEvent: unknown) => {
    const event = rawEvent as CommandMonitoringEvent;
    let measuredDuration = typeof event?.duration === 'number' ? event.duration : 0;

    const key = getCommandKey(rawEvent);
    if (key !== null) {
      const startTime = commandStartTimes.get(key);
      if (startTime !== undefined) {
        commandStartTimes.delete(key);
        const elapsed = performance.now() - startTime;
        if (elapsed > 0) {
          measuredDuration = elapsed;
        }
      }
    }

    const store = timingContext.getStore();
    if (store) {
      store.dbRoundTrips += 1;
      store.dbTimeMs += measuredDuration;
    }
  };

  // Attach command monitoring listeners directly to the actual MongoClient driver instance
  targetClient.on('commandStarted', onCommandStarted);
  targetClient.on('commandSucceeded', onCommandFinished);
  targetClient.on('commandFailed', onCommandFinished);
  monitoredClients.add(targetClient);
}

// Automatically attach listeners when Mongoose establishes or reconnects a connection
if (typeof mongoose !== 'undefined' && mongoose.connection) {
  mongoose.connection.on('open', () => {
    try {
      const client = mongoose.connection.getClient();
      if (client) {
        attachCommandMonitoring(client);
      }
    } catch {
      // Driver client not ready yet
    }
  });

  if (mongoose.connection.readyState === 1) {
    try {
      const client = mongoose.connection.getClient();
      if (client) {
        attachCommandMonitoring(client);
      }
    } catch {
      // Driver client not ready yet
    }
  }
}

export function withServerTiming<T extends unknown[]>(
  handler: (req: NextRequest, ...args: T) => Promise<NextResponse | Response>
) {
  return async (req: NextRequest, ...args: T) => {
    // Ensure monitoring is attached to the active MongoClient before request database operations execute
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      try {
        const client = mongoose.connection.getClient();
        if (client) {
          attachCommandMonitoring(client);
        }
      } catch {
        // Driver client not ready yet
      }
    }
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

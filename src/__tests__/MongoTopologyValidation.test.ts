/**
 * MongoTopologyValidation.test.ts
 *
 * Focused tests for startup topology enforcement (Week-4 production hardening).
 *
 * These tests verify that validateMongoTopology() enforces the correct rules
 * for each combination of NODE_ENV and MongoDB topology type, without
 * requiring a real MongoDB connection.  All mongoose internals are replaced by
 * a lightweight vi.mock so the tests are fast, deterministic, and isolated.
 *
 * Matrix:
 *   1. production  + ReplicaSetWithPrimary → allowed   (no error)
 *   2. production  + Single (standalone)   → throws fatal Error
 *   3. development + Single (standalone)   → allowed   (no error)
 *   4. test        + Single (standalone)   → allowed   (test env always exempt)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type mongoose from 'mongoose';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal fake mongoose.connection whose .client.topology.description
 * reports the requested topology type.
 */
function makeConnection(topologyType: string): typeof mongoose.connection {
    return {
        getClient: () => ({
            topology: {
                description: {
                    type: topologyType,
                },
            },
        }),
    } as unknown as typeof mongoose.connection;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('validateMongoTopology – startup topology enforcement', () => {
    beforeEach(() => {
        // Isolate the module so NODE_ENV changes are reflected inside the module
        vi.resetModules();
    });

    afterEach(() => {
        // Restore NODE_ENV after every test
        vi.unstubAllEnvs();
        vi.resetModules();
    });

    // -----------------------------------------------------------------------
    // Test 1: production + replica-set → allowed
    // -----------------------------------------------------------------------
    it('allows startup in production when topology is ReplicaSetWithPrimary', async () => {
        vi.stubEnv('NODE_ENV', 'production');

        const { validateMongoTopology } = await import('../lib/validateMongoTopology');
        const connection = makeConnection('ReplicaSetWithPrimary');

        expect(() => validateMongoTopology(connection)).not.toThrow();
    });

    // -----------------------------------------------------------------------
    // Test 2: production + standalone → startup validation fails
    // -----------------------------------------------------------------------
    it('throws a fatal error in production when topology is Single (standalone)', async () => {
        vi.stubEnv('NODE_ENV', 'production');

        const { validateMongoTopology } = await import('../lib/validateMongoTopology');
        const connection = makeConnection('Single');

        expect(() => validateMongoTopology(connection)).toThrow(
            /FATAL: Production requires a MongoDB replica set/
        );
        expect(() => validateMongoTopology(connection)).toThrow(
            /"Single"/
        );
        expect(() => validateMongoTopology(connection)).toThrow(
            /Application cannot start/
        );
    });

    // -----------------------------------------------------------------------
    // Test 3: development + standalone → allowed
    // -----------------------------------------------------------------------
    it('allows startup in development when topology is Single (standalone)', async () => {
        vi.stubEnv('NODE_ENV', 'development');

        const { validateMongoTopology } = await import('../lib/validateMongoTopology');
        const connection = makeConnection('Single');

        expect(() => validateMongoTopology(connection)).not.toThrow();
    });

    // -----------------------------------------------------------------------
    // Test 4: test environment → existing test setup continues to work
    // -----------------------------------------------------------------------
    it('allows startup in test environment regardless of topology type', async () => {
        vi.stubEnv('NODE_ENV', 'test');

        const { validateMongoTopology } = await import('../lib/validateMongoTopology');

        // Even a standalone topology must not block the test environment
        const standaloneConn = makeConnection('Single');
        expect(() => validateMongoTopology(standaloneConn)).not.toThrow();

        // And the MongoMemoryReplSet topology must also be allowed
        const replSetConn = makeConnection('ReplicaSetWithPrimary');
        expect(() => validateMongoTopology(replSetConn)).not.toThrow();
    });

    // -----------------------------------------------------------------------
    // Additional production cases: all valid topology types must be accepted
    // -----------------------------------------------------------------------
    it.each([
        'ReplicaSetWithPrimary',
        'ReplicaSetNoPrimary',
        'Sharded',
        'LoadBalanced',
    ])('production + %s topology → allowed', async (topologyType) => {
        vi.stubEnv('NODE_ENV', 'production');

        const { validateMongoTopology } = await import('../lib/validateMongoTopology');
        const connection = makeConnection(topologyType);

        expect(() => validateMongoTopology(connection)).not.toThrow();
    });

    // -----------------------------------------------------------------------
    // Edge case: topology not yet set (client.topology is undefined)
    // -----------------------------------------------------------------------
    it('throws in production when topology is Unknown (driver not yet initialised)', async () => {
        vi.stubEnv('NODE_ENV', 'production');

        const { validateMongoTopology } = await import('../lib/validateMongoTopology');
        // Simulate a connection where .getClient().topology is undefined
        const connection = {
            getClient: () => ({}),
        } as unknown as typeof mongoose.connection;

        // 'Unknown' is returned by getTopologyType when topology is absent,
        // and 'Unknown' is not in the transaction-capable set.
        expect(() => validateMongoTopology(connection)).toThrow(/FATAL/);
    });

    it('does not throw in development when topology is Unknown', async () => {
        vi.stubEnv('NODE_ENV', 'development');

        const { validateMongoTopology } = await import('../lib/validateMongoTopology');
        const connection = {
            client: {},
        } as unknown as typeof mongoose.connection;

        expect(() => validateMongoTopology(connection)).not.toThrow();
    });
});

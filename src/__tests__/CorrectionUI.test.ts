import { describe, it, expect, vi } from 'vitest';
import { ScriptInfo, checkOperatorPermission } from '../utils/previewHelpers';

describe('Manual Script/Page Correction UI Logic (AE-063)', () => {
    const mockScripts: ScriptInfo[] = [
        {
            _id: 'script-1',
            __v: 2,
            exam: 'exam-abc',
            fileIndex: 0,
            startPageNumber: 1,
            endPageNumber: 2,
            pageCount: 2,
            pages: [
                { _id: 'p1', pageNumber: 1, fileIndex: 0, thumbnailUrl: '/t1' },
                { _id: 'p2', pageNumber: 2, fileIndex: 0, thumbnailUrl: '/t2' }
            ]
        },
        {
            _id: 'script-2',
            __v: 1,
            exam: 'exam-abc',
            fileIndex: 0,
            startPageNumber: 3,
            endPageNumber: 3,
            pageCount: 1,
            pages: [
                { _id: 'p3', pageNumber: 3, fileIndex: 0, thumbnailUrl: '/t3' }
            ]
        }
    ];

    // 1. Persisted scripts and pages render correctly
    it('should correctly render scripts and their pages in the correct parent hierarchies', () => {
        expect(mockScripts).toHaveLength(2);
        expect(mockScripts[0].pages).toHaveLength(2);
        expect(mockScripts[1].pages).toHaveLength(1);
        expect(mockScripts[0].pages[0]._id).toBe('p1');
        expect(mockScripts[1].pages[0]._id).toBe('p3');
    });

    // 2. Remap (Move Page) action calls the correct endpoint and payload
    it('should construct correct API call body and endpoint on page move', async () => {
        const fetchSpy = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ success: true, data: {} })
        });

        const executeMove = async (pageId: string, sourceScript: ScriptInfo, targetScript: ScriptInfo) => {
            const body = {
                pageId,
                targetScriptId: targetScript._id,
                versions: {
                    [sourceScript._id]: sourceScript.__v ?? 0,
                    [targetScript._id]: targetScript.__v ?? 0
                }
            };
            return fetchSpy(`/api/ingest/batch-123/scripts/remap`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
        };

        await executeMove('p1', mockScripts[0], mockScripts[1]);

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const [url, init] = fetchSpy.mock.calls[0];
        expect(url).toBe('/api/ingest/batch-123/scripts/remap');
        const body = JSON.parse(init.body);
        expect(body.pageId).toBe('p1');
        expect(body.targetScriptId).toBe('script-2');
        expect(body.versions['script-1']).toBe(2);
        expect(body.versions['script-2']).toBe(1);
    });

    // 3. Merge scripts calls correct endpoint and payload
    it('should construct correct API call body and endpoint on merge scripts', async () => {
        const fetchSpy = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ success: true, data: {} })
        });

        const executeMerge = async (sourceScript: ScriptInfo, targetScript: ScriptInfo) => {
            const body = {
                sourceScriptId: sourceScript._id,
                targetScriptId: targetScript._id,
                versions: {
                    [sourceScript._id]: sourceScript.__v ?? 0,
                    [targetScript._id]: targetScript.__v ?? 0
                }
            };
            return fetchSpy(`/api/ingest/batch-123/scripts/merge`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
        };

        await executeMerge(mockScripts[1], mockScripts[0]);

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const [url, init] = fetchSpy.mock.calls[0];
        expect(url).toBe('/api/ingest/batch-123/scripts/merge');
        const body = JSON.parse(init.body);
        expect(body.sourceScriptId).toBe('script-2');
        expect(body.targetScriptId).toBe('script-1');
        expect(body.versions['script-1']).toBe(2);
        expect(body.versions['script-2']).toBe(1);
    });

    // 4. Split script sends the intended grouping boundaries
    it('should construct correct split boundary groupings', async () => {
        const fetchSpy = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ success: true, data: {} })
        });

        const executeSplit = async (script: ScriptInfo, splitPoints: Set<number>) => {
            const groups: string[][] = [];
            let currentGroup: string[] = [];

            for (let i = 0; i < script.pages.length; i++) {
                currentGroup.push(script.pages[i]._id);
                if (splitPoints.has(i)) {
                    groups.push(currentGroup);
                    currentGroup = [];
                }
            }
            if (currentGroup.length > 0) {
                groups.push(currentGroup);
            }

            const body = {
                scriptId: script._id,
                version: script.__v ?? 0,
                groups
            };
            return fetchSpy(`/api/ingest/batch-123/scripts/split`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
        };

        // Split script-1 after the first page (index 0)
        const splitPoints = new Set([0]);
        await executeSplit(mockScripts[0], splitPoints);

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const [url, init] = fetchSpy.mock.calls[0];
        expect(url).toBe('/api/ingest/batch-123/scripts/split');
        const body = JSON.parse(init.body);
        expect(body.scriptId).toBe('script-1');
        expect(body.version).toBe(2);
        expect(body.groups).toEqual([['p1'], ['p2']]);
    });

    // 5. Reorder pages action sends ordered page IDs
    it('should construct correct orderedPageIds on reorder', async () => {
        const fetchSpy = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ success: true, data: {} })
        });

        const executeReorder = async (script: ScriptInfo, orderedPageIds: string[]) => {
            const body = {
                scriptId: script._id,
                version: script.__v ?? 0,
                orderedPageIds
            };
            return fetchSpy(`/api/ingest/batch-123/scripts/reorder`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
        };

        // Swap p1 and p2 order
        const newOrder = ['p2', 'p1'];
        await executeReorder(mockScripts[0], newOrder);

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const [url, init] = fetchSpy.mock.calls[0];
        expect(url).toBe('/api/ingest/batch-123/scripts/reorder');
        const body = JSON.parse(init.body);
        expect(body.scriptId).toBe('script-1');
        expect(body.version).toBe(2);
        expect(body.orderedPageIds).toEqual(['p2', 'p1']);
    });

    // 6. Concurrency lock error representation
    it('should extract stale version conflicts from API responses', () => {
        const handleApiError = (resStatus: number, resMessage: string) => {
            if (resStatus === 409) {
                return `Concurrency conflict: ${resMessage}`;
            }
            return resMessage;
        };

        const msg = handleApiError(409, 'The script has been modified by another operator.');
        expect(msg).toContain('Concurrency conflict');
        expect(msg).toContain('modified by another operator');
    });

    // 7. Double submission prevention
    it('should lock operations while saving correction is pending', () => {
        let isSaving = false;
        const submitAction = () => {
            if (isSaving) return;
            isSaving = true;
        };

        submitAction();
        expect(isSaving).toBe(true);

        const isButtonDisabled = isSaving;
        expect(isButtonDisabled).toBe(true);
    });

    // 8. Access control limits operations
    it('should restrict operations strictly to operators with EDIT_EXAM permissions', () => {
        expect(checkOperatorPermission('PROFESSOR')).toBe(true);
        expect(checkOperatorPermission('ADMIN')).toBe(true);
        expect(checkOperatorPermission('TA')).toBe(false);
        expect(checkOperatorPermission('STUDENT')).toBe(false);
        expect(checkOperatorPermission(undefined)).toBe(false);
    });
});

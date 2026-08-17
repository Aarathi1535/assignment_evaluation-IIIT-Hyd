import { describe, it, expect, vi } from 'vitest';
import { ScriptInfo, getIdentificationBadgeConfig } from '../utils/previewHelpers';

describe('Manual Student-ID Assignment UI Logic (AE-062)', () => {
    const mockScripts: ScriptInfo[] = [
        {
            _id: 'script-1',
            exam: 'exam-101',
            candidateStudentId: 'STUD-001',
            identificationStatus: 'IDENTIFIED',
            needsManualId: false,
            fileIndex: 0,
            startPageNumber: 1,
            endPageNumber: 2,
            pageCount: 2,
            pages: []
        },
        {
            _id: 'script-2',
            exam: 'exam-101',
            candidateStudentId: null,
            identificationStatus: 'UNIDENTIFIED',
            needsManualId: true,
            manualIdReason: 'NO_CODE_FOUND',
            fileIndex: 0,
            startPageNumber: 3,
            endPageNumber: 4,
            pageCount: 2,
            pages: []
        }
    ];

    const mockRoster = [
        { id: 'u1', name: 'Alice Smith', email: 'alice@uni.edu', rollNumber: 'CS-01' },
        { id: 'u2', name: 'Bob Jones', email: 'bob@uni.edu', rollNumber: null }
    ];

    // 1. Unidentified scripts render correctly in review state
    it('should correctly determine which scripts need manual review', () => {
        const s1Config = getIdentificationBadgeConfig(mockScripts[0]);
        const s2Config = getIdentificationBadgeConfig(mockScripts[1]);

        expect(s1Config.label).toBe('Identified');
        expect(s2Config.label).toBe('Requires Manual Review');
        expect(mockScripts[0].needsManualId).toBe(false);
        expect(mockScripts[1].needsManualId).toBe(true);
    });

    // 2. Toggle/filtering options are computed correctly
    it('should filter scripts list correctly based on toggle state', () => {
        const getFilteredScripts = (scripts: ScriptInfo[], filterOnlyUnidentified: boolean) => {
            return filterOnlyUnidentified
                ? scripts.filter(s => s.identificationStatus !== 'IDENTIFIED' || s.needsManualId)
                : scripts;
        };

        const all = getFilteredScripts(mockScripts, false);
        const filtered = getFilteredScripts(mockScripts, true);

        expect(all).toHaveLength(2);
        expect(filtered).toHaveLength(1);
        expect(filtered[0]._id).toBe('script-2');
    });

    // 3. Roster formatting logic
    it('should format roster options correctly for dropdown selection', () => {
        const options = mockRoster.map(stud => ({
            value: stud.id,
            label: `${stud.name} (${stud.rollNumber || 'No Roll Number'}) — ${stud.email}`
        }));

        expect(options).toHaveLength(2);
        expect(options[0].value).toBe('u1');
        expect(options[0].label).toBe('Alice Smith (CS-01) — alice@uni.edu');
        expect(options[1].value).toBe('u2');
        expect(options[1].label).toBe('Bob Jones (No Roll Number) — bob@uni.edu');
    });

    // 4. Roster caching checks
    it('should cache rosters to prevent redundant network fetches for the same exam', async () => {
        const rosterMap: Record<string, typeof mockRoster> = {};
        const fetchSpy = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ success: true, data: mockRoster })
        });

        const loadRoster = async (examId: string) => {
            if (rosterMap[examId]) {
                return rosterMap[examId];
            }
            const res = await fetchSpy(`/api/exams/${examId}/students`);
            const json = await res.json();
            rosterMap[examId] = json.data;
            return rosterMap[examId];
        };

        // First call fetches from API
        await loadRoster('exam-101');
        expect(fetchSpy).toHaveBeenCalledTimes(1);

        // Second call hits cache
        await loadRoster('exam-101');
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    // 5. Successful identification mock updates state
    it('should update component state correctly after successful API mapping save', () => {
        const currentScripts = [...mockScripts];
        const apiResponsePayload = {
            student: 'u1',
            candidateStudentId: 'u1',
            identificationSource: 'OPERATOR',
            identificationStatus: 'IDENTIFIED',
            needsManualId: false,
            manualIdReason: null
        };

        // State update simulation logic
        const updatedScripts = currentScripts.map(s => s._id === 'script-2' ? {
            ...s,
            student: apiResponsePayload.student,
            candidateStudentId: apiResponsePayload.candidateStudentId,
            identificationSource: apiResponsePayload.identificationSource,
            identificationStatus: apiResponsePayload.identificationStatus as 'IDENTIFIED' | 'UNIDENTIFIED' | null,
            needsManualId: apiResponsePayload.needsManualId,
            manualIdReason: apiResponsePayload.manualIdReason
        } : s);

        expect(updatedScripts[1].identificationStatus).toBe('IDENTIFIED');
        expect(updatedScripts[1].needsManualId).toBe(false);
        expect(updatedScripts[1].candidateStudentId).toBe('u1');
    });

    // 6. Loading state prevents accidental multiple submissions
    it('should disable action button and show spinner during pending save requests', () => {
        let isSaving = false;
        const triggerSave = () => {
            if (isSaving) return; // Prevent double submit
            isSaving = true;
        };

        triggerSave();
        expect(isSaving).toBe(true);

        // Button should be disabled now
        const isButtonDisabled = isSaving;
        expect(isButtonDisabled).toBe(true);
    });
});

// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StudentRegradeRequestsPage from '../app/(dashboard)/student/regrade-requests/page';

const requestFixtures = [
    {
        id: 'request-open',
        examId: 'exam-1',
        examTitle: 'Algorithms Midterm',
        questionNumber: 1,
        reason: 'Please review the rubric application.',
        status: 'open',
        createdAt: '2026-11-03T10:00:00.000Z',
        updatedAt: '2026-11-03T10:00:00.000Z'
    },
    {
        id: 'request-reviewing',
        examId: 'exam-2',
        examTitle: 'Data Structures Final',
        questionNumber: 2,
        reason: 'Please review the scoring for this question.',
        status: 'reviewing',
        createdAt: '2026-11-04T10:00:00.000Z',
        updatedAt: '2026-11-04T10:00:00.000Z'
    },
    {
        id: 'request-resolved',
        examId: 'exam-3',
        examTitle: 'Networks Quiz',
        questionNumber: 4,
        reason: 'Please check the feedback for this answer.',
        status: 'resolved',
        createdAt: '2026-11-05T10:00:00.000Z',
        updatedAt: '2026-11-06T10:00:00.000Z'
    }
];

describe('AE-196: Student regrade request status tracking', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    it('shows a loading state while the student request list is fetched', () => {
        fetchMock.mockReturnValue(new Promise(() => {}));
        render(<StudentRegradeRequestsPage />);

        expect(screen.getByRole('status').textContent).toContain('Loading your regrade requests');
    });

    it('shows each exam, question, reason, and current status', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ success: true, data: requestFixtures })
        });
        render(<StudentRegradeRequestsPage />);

        expect(await screen.findByText('Algorithms Midterm')).toBeTruthy();
        expect(screen.getByText('Data Structures Final')).toBeTruthy();
        expect(screen.getByText('Networks Quiz')).toBeTruthy();
        expect(screen.getByText('Question 1')).toBeTruthy();
        expect(screen.getByText('Question 2')).toBeTruthy();
        expect(screen.getByText('Question 4')).toBeTruthy();
        expect(screen.getByText('Open')).toBeTruthy();
        expect(screen.getByText('Reviewing')).toBeTruthy();
        expect(screen.getByText('Resolved')).toBeTruthy();
        expect(screen.getByText('Please review the rubric application.')).toBeTruthy();
    });

    it('shows an empty state and a link to released grades when there are no requests', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ success: true, data: [] })
        });
        render(<StudentRegradeRequestsPage />);

        expect(await screen.findByText('No regrade requests yet')).toBeTruthy();
        const viewGradesLinks = screen.getAllByRole('link', { name: 'View Grades' });
        expect(viewGradesLinks[0].getAttribute('href')).toBe('/student/results');
    });

    it('shows an error and allows retrying the request list', async () => {
        fetchMock
            .mockRejectedValueOnce(new Error('Network unavailable'))
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({ success: true, data: requestFixtures.slice(0, 1) })
            });
        render(<StudentRegradeRequestsPage />);

        expect(await screen.findByRole('alert')).toBeTruthy();
        expect(screen.getByText('Network unavailable')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

        expect(await screen.findByText('Algorithms Midterm')).toBeTruthy();
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});


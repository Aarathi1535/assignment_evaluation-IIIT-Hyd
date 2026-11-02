// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RegradeRequestForm } from '../components/student/RegradeRequestForm';

describe('AE-194: Student regrade request form', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    function renderOpenForm() {
        const now = Date.now();
        return render(
            <RegradeRequestForm
                scriptId="student-script-194"
                questionNumbers={[1, 2, 4]}
                regradeWindowOpensAt={new Date(now - 60_000).toISOString()}
                regradeWindowClosesAt={new Date(now + 60_000).toISOString()}
            />
        );
    }

    it('shows eligible questions and the current regrade window state', () => {
        renderOpenForm();

        expect(screen.getByRole('status').textContent).toContain('Regrade window is currently open.');
        expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual([
            'Question 1',
            'Question 2',
            'Question 4'
        ]);
        expect((screen.getByRole('button', { name: 'Submit regrade request' }) as HTMLButtonElement).disabled).toBe(false);
    });

    it('submits the selected question and justification and shows success', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            status: 201,
            json: async () => ({ success: true, data: { id: 'request-1' } })
        });
        renderOpenForm();

        fireEvent.change(screen.getByLabelText('Question'), { target: { value: '2' } });
        fireEvent.change(screen.getByLabelText('Justification'), {
            target: { value: 'The rubric criteria were not applied to my answer.' }
        });
        await act(async () => {
            fireEvent.submit(screen.getByRole('form', { name: 'Regrade request' }));
        });

        expect(await screen.findByText('Your regrade request was submitted successfully.')).toBeTruthy();
        expect(fetchMock).toHaveBeenCalledWith('/api/student/regrade-requests', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
                scriptId: 'student-script-194',
                questionNumber: 2,
                reason: 'The rubric criteria were not applied to my answer.'
            })
        });
    });

    it('disables submission outside the regrade window', () => {
        const past = new Date(Date.now() - 60_000).toISOString();
        render(
            <RegradeRequestForm
                scriptId="student-script-194"
                questionNumbers={[1]}
                regradeWindowOpensAt={past}
                regradeWindowClosesAt={past}
            />
        );

        expect(screen.getByText('Regrade window is currently closed.')).toBeTruthy();
        expect((screen.getByRole('button', { name: 'Submit regrade request' }) as HTMLButtonElement).disabled).toBe(true);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('shows the loading state while the request is pending', async () => {
        let resolveFetch!: () => void;
        fetchMock.mockReturnValue(new Promise(resolve => {
            resolveFetch = () => resolve({
                ok: true,
                status: 201,
                json: async () => ({ success: true })
            });
        }));
        renderOpenForm();
        fireEvent.change(screen.getByLabelText('Justification'), {
            target: { value: 'The rubric criteria were not applied to my answer.' }
        });

        await act(async () => {
            fireEvent.submit(screen.getByRole('form', { name: 'Regrade request' }));
        });
        expect((screen.getByRole('button', { name: 'Submitting…' }) as HTMLButtonElement).disabled).toBe(true);

        await act(async () => {
            resolveFetch();
        });
        await waitFor(() => {
            expect(screen.getByText('Your regrade request was submitted successfully.')).toBeTruthy();
        });
    });

    it('shows the server error when the request is rejected', async () => {
        fetchMock.mockResolvedValue({
            ok: false,
            status: 409,
            json: async () => ({ success: false, message: 'An open regrade request already exists.' })
        });
        renderOpenForm();
        fireEvent.change(screen.getByLabelText('Justification'), {
            target: { value: 'The rubric criteria were not applied to my answer.' }
        });

        await act(async () => {
            fireEvent.submit(screen.getByRole('form', { name: 'Regrade request' }));
        });

        expect((await screen.findByRole('alert')).textContent).toContain('An open regrade request already exists.');
    });
});

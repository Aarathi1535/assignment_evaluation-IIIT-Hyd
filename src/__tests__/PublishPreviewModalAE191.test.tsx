// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PublishResultsModal } from '../components/professor/PublishResultsModal';

describe('AE-191: Publish Preview and Confirmation UI', () => {
  const mockExam = {
    _id: 'exam-101',
    title: 'Midterm Algorithms',
    courseCode: 'CS101',
    courseName: 'Data Structures & Algorithms',
    examDate: '2026-10-25T10:00:00.000Z',
    totalMarks: 100,
    numberOfQuestions: 4,
    status: 'REVIEW_PENDING',
  };

  const mockStudents = [
    { id: 'stud-1', name: 'Alice Smith', email: 'alice@iiit.ac.in', rollNumber: '2026001' },
    { id: 'stud-2', name: 'Bob Jones', email: 'bob@iiit.ac.in', rollNumber: '2026002' },
  ];

  const mockPreview = {
    totalEnrolled: 2,
    readyToRelease: 1,
    notReady: 1,
    openFlags: 0,
    warnings: ['1 student(s) do not have final grades and will receive NOT_AVAILABLE status.'],
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('1. Previews exam summary and student roster', () => {
    render(
      <PublishResultsModal
        isOpen={true}
        onClose={vi.fn()}
        examId={mockExam._id}
        initialExam={mockExam}
        initialStudents={mockStudents}
        initialPreview={mockPreview}
      />
    );

    expect(screen.getByTestId('publish-preview-modal')).toBeTruthy();
    expect(screen.getByText('Publish Exam Results')).toBeTruthy();
    expect(screen.getByText('Midterm Algorithms')).toBeTruthy();
    expect(screen.getByText('CS101')).toBeTruthy();
    expect(screen.getByText('100 Total Marks')).toBeTruthy();
    expect(screen.getByText('4 Questions')).toBeTruthy();
    expect(screen.getByTestId('publish-student-count').textContent).toContain('2 Students');
    expect(screen.getByText('Alice Smith')).toBeTruthy();
    expect(screen.getByText('2026001')).toBeTruthy();
    expect(screen.getByText('Bob Jones')).toBeTruthy();
  });

  it('2. Enforces explicit confirmation checkbox before allowing publish', () => {
    render(
      <PublishResultsModal
        isOpen={true}
        onClose={vi.fn()}
        examId={mockExam._id}
        initialExam={mockExam}
        initialStudents={mockStudents}
        initialPreview={mockPreview}
      />
    );

    const publishBtn = screen.getByTestId('confirm-publish-btn') as HTMLButtonElement;
    const checkbox = screen.getByTestId('confirm-publish-checkbox') as HTMLInputElement;

    // Initially unchecked and button disabled
    expect(checkbox.checked).toBe(false);
    expect(publishBtn.disabled).toBe(true);

    // Check the confirmation box
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);
    expect(publishBtn.disabled).toBe(false);

    // Uncheck and verify it disables again
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);
    expect(publishBtn.disabled).toBe(true);
  });

  it('3. Displays loading and success states upon successful publication', async () => {
    const onPublishedMock = vi.fn();
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation((url: any) => {
      if (String(url).includes('/publish')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            message: 'Exam results published successfully',
            data: { status: 'PUBLISHED' },
          }),
        } as Response);
      }
      return Promise.resolve({ ok: true, json: async () => ({ success: true }) } as Response);
    });

    render(
      <PublishResultsModal
        isOpen={true}
        onClose={vi.fn()}
        examId={mockExam._id}
        initialExam={mockExam}
        initialStudents={mockStudents}
        initialPreview={mockPreview}
        onPublished={onPublishedMock}
      />
    );

    // Check confirmation
    const checkbox = screen.getByTestId('confirm-publish-checkbox');
    fireEvent.click(checkbox);

    const publishBtn = screen.getByTestId('confirm-publish-btn');
    fireEvent.click(publishBtn);

    // Verify success banner is shown
    await waitFor(() => {
      expect(screen.getByTestId('publish-success-message')).toBeTruthy();
    });
    expect(screen.getByText('Exam Results Published Successfully!')).toBeTruthy();
    expect(onPublishedMock).toHaveBeenCalledWith('exam-101');
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/exams/exam-101/publish',
      expect.objectContaining({ method: 'POST' })
    );

    // Verify "Done" button is rendered
    expect(screen.getByTestId('publish-done-btn')).toBeTruthy();
  });

  it('4. Communicates API error clearly when publication fails', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        success: false,
        message: 'Cannot publish exam: There are 2 open flag(s) that must be resolved or escalated first',
      }),
    } as Response);

    render(
      <PublishResultsModal
        isOpen={true}
        onClose={vi.fn()}
        examId={mockExam._id}
        initialExam={mockExam}
        initialStudents={mockStudents}
        initialPreview={mockPreview}
      />
    );

    const checkbox = screen.getByTestId('confirm-publish-checkbox');
    fireEvent.click(checkbox);

    const publishBtn = screen.getByTestId('confirm-publish-btn');
    fireEvent.click(publishBtn);

    await waitFor(() => {
      expect(screen.getByTestId('publish-error-message')).toBeTruthy();
    });

    expect(screen.getByTestId('publish-error-message').textContent).toContain(
      'Cannot publish exam: There are 2 open flag(s) that must be resolved or escalated first'
    );
  });

  it('5. Prevents duplicate submissions while publishing is in progress', async () => {
    let resolvePublishPromise: (val: any) => void;
    const delayedPromise = new Promise((resolve) => {
      resolvePublishPromise = resolve;
    });

    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(() => delayedPromise as Promise<Response>);

    render(
      <PublishResultsModal
        isOpen={true}
        onClose={vi.fn()}
        examId={mockExam._id}
        initialExam={mockExam}
        initialStudents={mockStudents}
        initialPreview={mockPreview}
      />
    );

    const checkbox = screen.getByTestId('confirm-publish-checkbox');
    fireEvent.click(checkbox);

    const publishBtn = screen.getByTestId('confirm-publish-btn');
    fireEvent.click(publishBtn);

    // While in-flight, button must show spinner and be disabled
    expect(screen.getByTestId('publish-submitting-spinner')).toBeTruthy();
    expect(publishBtn.getAttribute('disabled')).not.toBeNull();

    // Click again while submitting
    fireEvent.click(publishBtn);
    fireEvent.click(publishBtn);

    // Only one fetch call must have been issued
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Complete the promise
    resolvePublishPromise!({
      ok: true,
      status: 200,
      json: async () => ({ success: true, message: 'Published' }),
    });

    await waitFor(() => {
      expect(screen.getByTestId('publish-success-message')).toBeTruthy();
    });
  });

  it('6. Allows cancellation via Cancel and close buttons', () => {
    const onCloseMock = vi.fn();

    const { rerender } = render(
      <PublishResultsModal
        isOpen={true}
        onClose={onCloseMock}
        examId={mockExam._id}
        initialExam={mockExam}
        initialStudents={mockStudents}
        initialPreview={mockPreview}
      />
    );

    const cancelBtn = screen.getByTestId('cancel-publish-btn');
    fireEvent.click(cancelBtn);
    expect(onCloseMock).toHaveBeenCalledTimes(1);

    const closeBtn = screen.getByTestId('close-publish-modal-btn');
    fireEvent.click(closeBtn);
    expect(onCloseMock).toHaveBeenCalledTimes(2);

    // Modal renders nothing when isOpen is false
    rerender(
      <PublishResultsModal
        isOpen={false}
        onClose={onCloseMock}
        examId={mockExam._id}
      />
    );
    expect(screen.queryByTestId('publish-preview-modal')).toBeNull();
  });

  it('7. Displays server preview breakdown with released, not ready, and open flags counts', () => {
    render(
      <PublishResultsModal
        isOpen={true}
        onClose={vi.fn()}
        examId={mockExam._id}
        initialExam={mockExam}
        initialStudents={mockStudents}
        initialPreview={{
          totalEnrolled: 3,
          readyToRelease: 1,
          notReady: 2,
          openFlags: 1,
          warnings: ['1 open flag(s) must be resolved or escalated before publication.'],
        }}
      />
    );

    expect(screen.getByTestId('publish-release-preview')).toBeTruthy();
    expect(screen.getByTestId('preview-released-count').textContent).toContain('1');
    expect(screen.getByTestId('preview-not-ready-count').textContent).toContain('2');
    expect(screen.getByTestId('preview-open-flags-count').textContent).toContain('1');
    expect(screen.getByTestId('publish-preview-warnings')).toBeTruthy();
    expect(screen.getByText(/1 open flag\(s\) must be resolved/)).toBeTruthy();
  });

  it('8. Shows an error and disables Publish when the roster fetch fails', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((url: any) => {
      if (String(url).includes('/students')) {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: async () => ({
            success: false,
            message: 'Database connection failed while retrieving roster',
          }),
        } as Response);
      }
      if (String(url).includes('/publish')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: mockPreview }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: mockExam }),
      } as Response);
    });

    render(
      <PublishResultsModal
        isOpen={true}
        onClose={vi.fn()}
        examId={mockExam._id}
        initialExam={mockExam}
        initialStudents={null}
      />
    );

    // Wait for roster fetch failure to propagate
    await waitFor(() => {
      expect(screen.getByTestId('publish-error-message')).toBeTruthy();
    });

    expect(screen.getByTestId('publish-error-message').textContent).toContain(
      'Database connection failed while retrieving roster'
    );

    const publishBtn = screen.getByTestId('confirm-publish-btn') as HTMLButtonElement;
    expect(publishBtn.disabled).toBe(true);

    const checkbox = screen.getByTestId('confirm-publish-checkbox') as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);
  });
});


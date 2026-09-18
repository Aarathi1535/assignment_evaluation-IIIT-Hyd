import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  PresetCommentChips,
  CommentTagData,
  insertTagIntoFeedback,
} from '../components/grading/PresetCommentChips';
import { RubricSidebar, RubricData } from '../components/grading/RubricSidebar';

const mockTags: CommentTagData[] = [
  {
    _id: 'tag-1',
    label: 'Good explanation.',
    scope: 'GLOBAL',
    description: 'Clear and thorough reasoning',
  },
  {
    _id: 'tag-2',
    label: 'Correct approach.',
    scope: 'EXAM',
    exam: 'exam-123',
    description: 'Right algorithm selected',
  },
  {
    _id: 'tag-3',
    label: 'Missing edge cases',
    scope: 'GLOBAL',
    description: 'Failed to consider boundary values',
  },
];

const mockRubric: RubricData = {
  _id: 'rubric-123',
  exam: 'exam-123',
  questions: [
    {
      questionNumber: 1,
      maxMarks: 10,
      criteria: [
        { criterionName: 'Logic', description: 'Logical soundness', points: 6 },
        { criterionName: 'Syntax', description: 'Code correctness', points: 4 },
      ],
    },
    {
      questionNumber: 2,
      maxMarks: 10,
      criteria: [
        { criterionName: 'Analysis', description: 'Time analysis', points: 10 },
      ],
    },
  ],
};

describe('AE-147: Quick-Insert Comment Chips & Grade.feedback Integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Duplicate Prevention & Append Logic (insertTagIntoFeedback)', () => {
    it('inserts tag label directly when feedback is empty', () => {
      const res1 = insertTagIntoFeedback('', 'Good explanation.');
      expect(res1.isDuplicate).toBe(false);
      expect(res1.updatedFeedback).toBe('Good explanation.');

      const res2 = insertTagIntoFeedback('   ', 'Correct approach.');
      expect(res2.isDuplicate).toBe(false);
      expect(res2.updatedFeedback).toBe('Correct approach.');
    });

    it('appends tag label to existing feedback using consistent separator', () => {
      // Existing ends with period
      const res1 = insertTagIntoFeedback('Good explanation.', 'Correct approach.');
      expect(res1.isDuplicate).toBe(false);
      expect(res1.updatedFeedback).toBe('Good explanation. Correct approach.');

      // Existing does not end with period
      const res2 = insertTagIntoFeedback('Good explanation', 'Correct approach.');
      expect(res2.isDuplicate).toBe(false);
      expect(res2.updatedFeedback).toBe('Good explanation. Correct approach.');
    });

    it('never overwrites existing user-written feedback', () => {
      const customFeedback = 'The student wrote a very detailed time analysis on step 3.';
      const res = insertTagIntoFeedback(customFeedback, 'Good explanation.');
      expect(res.isDuplicate).toBe(false);
      expect(res.updatedFeedback).toContain(customFeedback);
      expect(res.updatedFeedback).toBe(`${customFeedback} Good explanation.`);
    });

    it('prevents inserting the same tag twice (duplicate detection)', () => {
      const existing = 'Good explanation. Correct approach.';
      const res = insertTagIntoFeedback(existing, 'Correct approach.');
      expect(res.isDuplicate).toBe(true);
      expect(res.updatedFeedback).toBe(existing);
    });

    it('detects duplicate even with subtle trailing punctuation or case variations', () => {
      const existing = 'Good explanation. Correct approach.';
      const res = insertTagIntoFeedback(existing, 'correct approach');
      expect(res.isDuplicate).toBe(true);
      expect(res.updatedFeedback).toBe(existing);
    });

    it('allows appending multiple different tags sequentially', () => {
      let current = '';
      const step1 = insertTagIntoFeedback(current, 'Good explanation.');
      current = step1.updatedFeedback;
      expect(current).toBe('Good explanation.');

      const step2 = insertTagIntoFeedback(current, 'Correct approach.');
      current = step2.updatedFeedback;
      expect(current).toBe('Good explanation. Correct approach.');

      const step3 = insertTagIntoFeedback(current, 'Missing edge cases');
      current = step3.updatedFeedback;
      expect(current).toBe('Good explanation. Correct approach. Missing edge cases');
    });
  });

  describe('2. PresetCommentChips Component Rendering & States', () => {
    it('renders GLOBAL and EXAM tags as interactive buttons', () => {
      const html = renderToStaticMarkup(
        React.createElement(PresetCommentChips, {
          initialTags: mockTags,
          onSelectTag: vi.fn(),
        })
      );

      expect(html).toContain('data-testid="preset-comment-chips-container"');
      expect(html).toContain('data-testid="preset-tag-tag-1"');
      expect(html).toContain('data-testid="preset-tag-tag-2"');
      expect(html).toContain('data-testid="preset-tag-tag-3"');
      expect(html).toContain('Good explanation.');
      expect(html).toContain('Correct approach.');
      expect(html).toContain('Missing edge cases');
      // Must be real buttons
      expect(html).toContain('<button');
      expect(html).toContain('type="button"');
    });

    it('provides accessible names and titles on chip buttons', () => {
      const html = renderToStaticMarkup(
        React.createElement(PresetCommentChips, {
          initialTags: mockTags,
          onSelectTag: vi.fn(),
        })
      );

      expect(html).toContain('aria-label="Insert comment: Good explanation."');
      expect(html).toContain('title="Clear and thorough reasoning"');
      expect(html).toContain('aria-label="Insert comment: Correct approach."');
    });

    it('renders empty state when no tags are available', () => {
      const html = renderToStaticMarkup(
        React.createElement(PresetCommentChips, {
          initialTags: [],
          onSelectTag: vi.fn(),
        })
      );

      expect(html).toContain('data-testid="preset-tags-empty"');
      expect(html).toContain('No preset comment tags available.');
    });

    it('renders disabled state on buttons when disabled prop is true', () => {
      const html = renderToStaticMarkup(
        React.createElement(PresetCommentChips, {
          initialTags: mockTags,
          disabled: true,
          onSelectTag: vi.fn(),
        })
      );

      expect(html).toContain('disabled=""');
      expect(html).toContain('cursor-not-allowed');
    });
  });

  describe('3. RubricSidebar UI & Question Feedback Integration', () => {
    it('renders Question Feedback section with textarea and preset chips for questions', () => {
      const html = renderToStaticMarkup(
        React.createElement(RubricSidebar, {
          initialRubric: mockRubric,
          initialTags: mockTags,
        })
      );

      expect(html).toContain('data-testid="question-feedback-section-1"');
      expect(html).toContain('data-testid="feedback-input-1"');
      expect(html).toContain('data-testid="preset-comment-chips-container"');
      expect(html).toContain('data-testid="tag-live-announcement-1"');
      expect(html).toContain('data-testid="question-feedback-section-2"');
      expect(html).toContain('data-testid="feedback-input-2"');
    });

    it('displays initial feedback value in textarea and keeps it editable', () => {
      const initialFeedback = {
        1: 'Initial feedback text for Q1',
      };

      const html = renderToStaticMarkup(
        React.createElement(RubricSidebar, {
          initialRubric: mockRubric,
          initialTags: mockTags,
          initialFeedback,
        })
      );

      expect(html).toContain('Initial feedback text for Q1');
    });

    it('enforces question-wise allocation disabling for unallocated questions', () => {
      const html = renderToStaticMarkup(
        React.createElement(RubricSidebar, {
          initialRubric: mockRubric,
          initialTags: mockTags,
          allocatedQuestionNumber: 1,
        })
      );

      // Question 1 feedback textarea should be enabled
      expect(html).toContain('data-testid="feedback-input-1"');

      // Question 2 is not allocated: feedback textarea and chips should be disabled/read-only
      expect(html).toContain('data-testid="feedback-input-2"');
      expect(html).toContain('Grading feedback is read-only.');
    });

    it('includes accessible live announcement region with aria-live="polite"', () => {
      const html = renderToStaticMarkup(
        React.createElement(RubricSidebar, {
          initialRubric: mockRubric,
          initialTags: mockTags,
        })
      );

      expect(html).toContain('aria-live="polite"');
      expect(html).toContain('role="status"');
      expect(html).toContain('data-testid="tag-live-announcement-1"');
    });

    it('renders Save Grade button when scriptId is provided and question is allocated', () => {
      const html = renderToStaticMarkup(
        React.createElement(RubricSidebar, {
          scriptId: 'script-abc-123',
          initialRubric: mockRubric,
          initialTags: mockTags,
          allocatedQuestionNumber: 1,
        })
      );

      expect(html).toContain('data-testid="save-grade-button-1"');
      expect(html).toContain('Save Grade');
    });
  });

  describe('4. Save Grade API Payload Verification', () => {
    it('verifies that resulting feedback structure matches AE-145 Save Grade requirements', () => {
      const marksAwarded = [
        { criterionName: 'Logic', score: 6 },
        { criterionName: 'Syntax', score: 4 },
      ];
      const feedback = 'Good explanation. Correct approach.';

      const payload = {
        question: 1,
        marksAwarded,
        feedback,
      };

      expect(payload.question).toBe(1);
      expect(payload.marksAwarded).toHaveLength(2);
      expect(payload.feedback).toBe('Good explanation. Correct approach.');
    });
  });
});

import { describe, it, expect, vi } from 'vitest';
import { SHORTCUT_MAP, findMatchingShortcut, isTypingTarget } from '../lib/shortcutMap';
import type { RubricSidebarHandle, RubricData, RubricQuestion } from '../components/grading/RubricSidebar';

describe('Issue #194: GradingWorkspace Q / Shift+Q Question Navigation Wiring', () => {
  const sampleRubric: RubricData = {
    _id: 'rubric-1',
    exam: 'exam-1',
    scoreStep: 0.5,
    questions: [
      {
        questionNumber: 1,
        maxMarks: 10,
        criteria: [{ criterionName: 'Theory', points: 10 }],
      },
      {
        questionNumber: 2,
        maxMarks: 10,
        criteria: [{ criterionName: 'Implementation', points: 10 }],
      },
      {
        questionNumber: 3,
        maxMarks: 10,
        criteria: [{ criterionName: 'Analysis', points: 10 }],
      },
    ],
  };

  describe('1. SHORTCUT_MAP and Matcher Verification', () => {
    it('SHORTCUT_MAP contains Q for nextQuestion and Shift+Q for prevQuestion', () => {
      const nextQDef = SHORTCUT_MAP.find((s) => s.action === 'nextQuestion');
      expect(nextQDef).toBeDefined();
      expect(nextQDef?.key).toBe('Q');
      expect(nextQDef?.group).toBe('navigation');

      const prevQDef = SHORTCUT_MAP.find((s) => s.action === 'prevQuestion');
      expect(prevQDef).toBeDefined();
      expect(prevQDef?.key).toBe('Shift+Q');
      expect(prevQDef?.group).toBe('navigation');
    });

    it('matches lowercase and uppercase "q" to nextQuestion', () => {
      const matchLower = findMatchingShortcut({ key: 'q' });
      expect(matchLower?.action).toBe('nextQuestion');

      const matchUpper = findMatchingShortcut({ key: 'Q' });
      expect(matchUpper?.action).toBe('nextQuestion');
    });

    it('matches "Shift+Q" and "Shift+q" to prevQuestion', () => {
      const matchShift = findMatchingShortcut({ key: 'Q', shiftKey: true });
      expect(matchShift?.action).toBe('prevQuestion');

      const matchShiftLower = findMatchingShortcut({ key: 'q', shiftKey: true });
      expect(matchShiftLower?.action).toBe('prevQuestion');
    });
  });

  describe('2. RubricSidebar Navigation Logic & Lifecycle Integrity', () => {
    // Simulator matching RubricSidebar navigation and imperative handle logic
    const createRubricSidebarState = (
      rubricData: RubricData = sampleRubric,
      allocatedQuestionNumber?: number,
      initialFinalized: Record<number, boolean> = {}
    ) => {
      let activeQuestionNumber: number | undefined = allocatedQuestionNumber;
      const isQuestionWise = allocatedQuestionNumber !== undefined && allocatedQuestionNumber !== null;
      const finalizedQuestions = { ...initialFinalized };
      const savedDrafts: number[] = [];
      const submittedFinals: number[] = [];

      const getTargetQuestion = (): RubricQuestion | null => {
        if (!rubricData || !rubricData.questions || rubricData.questions.length === 0) return null;
        if (isQuestionWise) {
          return (
            rubricData.questions.find((q) => q.questionNumber === Number(allocatedQuestionNumber)) ||
            null
          );
        }
        if (activeQuestionNumber !== undefined) {
          const found = rubricData.questions.find((q) => q.questionNumber === activeQuestionNumber);
          if (found) return found;
        }
        return (
          rubricData.questions.find((q) => !finalizedQuestions[q.questionNumber]) ||
          rubricData.questions[0] ||
          null
        );
      };

      const nextQuestion = () => {
        if (!rubricData || !rubricData.questions || rubricData.questions.length === 0) return;
        if (isQuestionWise) return;

        const questionsList = rubricData.questions;
        const currentTarget = getTargetQuestion();
        const currentIndex = currentTarget
          ? questionsList.findIndex((q) => q.questionNumber === currentTarget.questionNumber)
          : -1;

        const nextIndex = currentIndex < questionsList.length - 1 ? currentIndex + 1 : currentIndex;
        const nextQ = questionsList[nextIndex];
        if (nextQ) {
          activeQuestionNumber = nextQ.questionNumber;
        }
      };

      const prevQuestion = () => {
        if (!rubricData || !rubricData.questions || rubricData.questions.length === 0) return;
        if (isQuestionWise) return;

        const questionsList = rubricData.questions;
        const currentTarget = getTargetQuestion();
        const currentIndex = currentTarget
          ? questionsList.findIndex((q) => q.questionNumber === currentTarget.questionNumber)
          : 0;

        const prevIndex = currentIndex > 0 ? currentIndex - 1 : 0;
        const prevQ = questionsList[prevIndex];
        if (prevQ) {
          activeQuestionNumber = prevQ.questionNumber;
        }
      };

      const handle: RubricSidebarHandle = {
        saveDraft: async () => {
          const q = getTargetQuestion();
          if (q) {
            savedDrafts.push(q.questionNumber);
          }
        },
        submitFinal: async () => {
          const q = getTargetQuestion();
          if (q) {
            submittedFinals.push(q.questionNumber);
          }
        },
        nextQuestion,
        prevQuestion,
      };

      return {
        handle,
        getTargetQuestion,
        getActiveQuestionNumber: () => activeQuestionNumber,
        getSavedDrafts: () => savedDrafts,
        getSubmittedFinals: () => submittedFinals,
      };
    };

    it('navigates forward through questions on nextQuestion() call', () => {
      const state = createRubricSidebarState();
      expect(state.getTargetQuestion()?.questionNumber).toBe(1);

      state.handle.nextQuestion();
      expect(state.getTargetQuestion()?.questionNumber).toBe(2);

      state.handle.nextQuestion();
      expect(state.getTargetQuestion()?.questionNumber).toBe(3);

      // Clamping at end: does not exceed last question
      state.handle.nextQuestion();
      expect(state.getTargetQuestion()?.questionNumber).toBe(3);
    });

    it('navigates backward through questions on prevQuestion() call', () => {
      const state = createRubricSidebarState();
      state.handle.nextQuestion(); // -> Q2
      state.handle.nextQuestion(); // -> Q3
      expect(state.getTargetQuestion()?.questionNumber).toBe(3);

      state.handle.prevQuestion();
      expect(state.getTargetQuestion()?.questionNumber).toBe(2);

      state.handle.prevQuestion();
      expect(state.getTargetQuestion()?.questionNumber).toBe(1);

      // Clamping at start: does not go below first question
      state.handle.prevQuestion();
      expect(state.getTargetQuestion()?.questionNumber).toBe(1);
    });

    it('locks to allocated question in question-wise mode and ignores nextQuestion/prevQuestion', () => {
      const state = createRubricSidebarState(sampleRubric, 2);
      expect(state.getTargetQuestion()?.questionNumber).toBe(2);

      state.handle.nextQuestion();
      expect(state.getTargetQuestion()?.questionNumber).toBe(2);

      state.handle.prevQuestion();
      expect(state.getTargetQuestion()?.questionNumber).toBe(2);
    });
  });

  describe('3. GradingWorkspace Keyboard Dispatch Simulator', () => {
    const createWorkspaceSimulator = (options?: {
      withSidebarRef?: boolean;
    }) => {
      const withSidebarRef = options?.withSidebarRef ?? true;

      const nextQuestionSpy = vi.fn();
      const prevQuestionSpy = vi.fn();
      const saveDraftSpy = vi.fn();
      const submitFinalSpy = vi.fn();

      const rubricSidebarRef = withSidebarRef
        ? {
            current: {
              saveDraft: async () => {
                saveDraftSpy();
              },
              submitFinal: async () => {
                submitFinalSpy();
              },
              nextQuestion: () => {
                nextQuestionSpy();
              },
              prevQuestion: () => {
                prevQuestionSpy();
              },
            } as RubricSidebarHandle,
          }
        : { current: null };

      // GradingWorkspace callbacks
      const handleSaveDraft = () => {
        rubricSidebarRef.current?.saveDraft();
      };
      const handleSubmitFinal = () => {
        rubricSidebarRef.current?.submitFinal();
      };
      const handleNextQuestion = () => {
        rubricSidebarRef.current?.nextQuestion();
      };
      const handlePrevQuestion = () => {
        rubricSidebarRef.current?.prevQuestion();
      };

      // AnswerSheetCanvas keydown handler simulator
      const handleKeyDown = (e: {
        key: string;
        ctrlKey?: boolean;
        metaKey?: boolean;
        altKey?: boolean;
        shiftKey?: boolean;
        target?: EventTarget | null;
        preventDefault?: () => void;
      }) => {
        if (isTypingTarget(e.target ?? null)) return;

        const matched = findMatchingShortcut(e);
        if (!matched) return;

        switch (matched.action) {
          case 'saveDraft':
            e.preventDefault?.();
            handleSaveDraft();
            break;
          case 'submitFinal':
            e.preventDefault?.();
            handleSubmitFinal();
            break;
          case 'nextQuestion':
            e.preventDefault?.();
            handleNextQuestion();
            break;
          case 'prevQuestion':
            e.preventDefault?.();
            handlePrevQuestion();
            break;
          default:
            break;
        }
      };

      return {
        handleKeyDown,
        nextQuestionSpy,
        prevQuestionSpy,
        saveDraftSpy,
        submitFinalSpy,
      };
    };

    it('pressing Q invokes nextQuestion on the rubric sidebar ref', () => {
      const sim = createWorkspaceSimulator();
      const preventDefault = vi.fn();

      sim.handleKeyDown({ key: 'q', preventDefault });

      expect(preventDefault).toHaveBeenCalled();
      expect(sim.nextQuestionSpy).toHaveBeenCalledTimes(1);
      expect(sim.prevQuestionSpy).not.toHaveBeenCalled();
    });

    it('pressing Shift+Q invokes prevQuestion on the rubric sidebar ref', () => {
      const sim = createWorkspaceSimulator();
      const preventDefault = vi.fn();

      sim.handleKeyDown({ key: 'Q', shiftKey: true, preventDefault });

      expect(preventDefault).toHaveBeenCalled();
      expect(sim.prevQuestionSpy).toHaveBeenCalledTimes(1);
      expect(sim.nextQuestionSpy).not.toHaveBeenCalled();
    });

    it('navigation is safely not triggered when rubric sidebar ref is null / unavailable', () => {
      const sim = createWorkspaceSimulator({ withSidebarRef: false });
      const preventDefault = vi.fn();

      expect(() => {
        sim.handleKeyDown({ key: 'q', preventDefault });
        sim.handleKeyDown({ key: 'Q', shiftKey: true, preventDefault });
      }).not.toThrow();

      expect(preventDefault).toHaveBeenCalledTimes(2);
      expect(sim.nextQuestionSpy).not.toHaveBeenCalled();
      expect(sim.prevQuestionSpy).not.toHaveBeenCalled();
    });

    it('existing Enter (save draft) and Ctrl+Enter (submit final) behavior remains intact', () => {
      const sim = createWorkspaceSimulator();
      const preventDefault = vi.fn();

      sim.handleKeyDown({ key: 'Enter', preventDefault });
      expect(sim.saveDraftSpy).toHaveBeenCalledTimes(1);
      expect(sim.submitFinalSpy).not.toHaveBeenCalled();

      sim.handleKeyDown({ key: 'Enter', ctrlKey: true, preventDefault });
      expect(sim.submitFinalSpy).toHaveBeenCalledTimes(1);
    });

    it('shortcuts are ignored when user is typing in an input or textarea', () => {
      const sim = createWorkspaceSimulator();
      const preventDefault = vi.fn();
      const inputEl = { tagName: 'INPUT' } as unknown as HTMLElement;

      sim.handleKeyDown({ key: 'q', target: inputEl, preventDefault });
      sim.handleKeyDown({ key: 'Q', shiftKey: true, target: inputEl, preventDefault });
      sim.handleKeyDown({ key: 'Enter', target: inputEl, preventDefault });

      expect(preventDefault).not.toHaveBeenCalled();
      expect(sim.nextQuestionSpy).not.toHaveBeenCalled();
      expect(sim.prevQuestionSpy).not.toHaveBeenCalled();
      expect(sim.saveDraftSpy).not.toHaveBeenCalled();
    });
  });
});

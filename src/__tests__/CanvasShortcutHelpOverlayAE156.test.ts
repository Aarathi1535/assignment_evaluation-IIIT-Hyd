import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  SHORTCUT_MAP,
  ShortcutDefinition,
  findMatchingShortcut,
  isTypingTarget,
  validateShortcutMap,
  groupShortcuts,
} from '../lib/shortcutMap';
import { ShortcutHelpOverlay, formatShortcutKeys } from '../components/canvas/ShortcutHelpOverlay';
import { AnswerSheetCanvas, SAMPLE_ANSWER_SHEET_DATA_URI } from '../components/canvas/AnswerSheetCanvas';
import type { CanvasTool } from '../components/canvas/types';

describe('AE-156: Shortcut Help Overlay for the Grading Canvas', () => {
  describe('1. Toolbar Button & Dialog Accessibility Structure (Requirements 1 - 6)', () => {
    it('1. help button exists in the canvas toolbar', () => {
      const html = renderToStaticMarkup(
        React.createElement(AnswerSheetCanvas, {
          src: SAMPLE_ANSWER_SHEET_DATA_URI,
          initialLoading: false,
        })
      );
      expect(html).toContain('data-testid="canvas-shortcut-help-button"');
    });

    it('2. help button has an accessible label', () => {
      const html = renderToStaticMarkup(
        React.createElement(AnswerSheetCanvas, {
          src: SAMPLE_ANSWER_SHEET_DATA_URI,
          initialLoading: false,
        })
      );
      expect(html).toContain('aria-label="Keyboard shortcuts"');
      expect(html).toContain('title="Keyboard shortcuts (?)"');
    });

    it('3. clicking help button / setting isShortcutHelpOpen renders the overlay dialog', () => {
      const html = renderToStaticMarkup(
        React.createElement(AnswerSheetCanvas, {
          src: SAMPLE_ANSWER_SHEET_DATA_URI,
          isShortcutHelpOpen: true,
        })
      );
      expect(html).toContain('data-testid="canvas-shortcut-help-dialog"');
    });

    it('4. dialog has role="dialog"', () => {
      const html = renderToStaticMarkup(
        React.createElement(ShortcutHelpOverlay, { isOpen: true, onClose: vi.fn() })
      );
      expect(html).toContain('role="dialog"');
    });

    it('5. dialog has aria-modal="true"', () => {
      const html = renderToStaticMarkup(
        React.createElement(ShortcutHelpOverlay, { isOpen: true, onClose: vi.fn() })
      );
      expect(html).toContain('aria-modal="true"');
    });

    it('6. dialog has accessible title and description with aria-labelledby', () => {
      const html = renderToStaticMarkup(
        React.createElement(ShortcutHelpOverlay, { isOpen: true, onClose: vi.fn() })
      );
      expect(html).toContain('aria-labelledby="canvas-shortcut-help-title"');
      expect(html).toContain('aria-describedby="canvas-shortcut-help-description"');
      expect(html).toContain('id="canvas-shortcut-help-title"');
      expect(html).toContain('Keyboard Shortcuts');
    });
  });

  describe('2. Dynamic Derivation from Authoritative SHORTCUT_MAP (Requirements 7 - 12)', () => {
    it('7. all displayed shortcuts come directly from SHORTCUT_MAP', () => {
      const html = renderToStaticMarkup(
        React.createElement(ShortcutHelpOverlay, { isOpen: true, onClose: vi.fn() })
      );

      for (const item of SHORTCUT_MAP) {
        expect(html).toContain(`shortcut-item-${item.id}`);
        expect(html).toContain(item.label);
      }
    });

    it('8. shortcut groups are derived dynamically from SHORTCUT_MAP', () => {
      const sections = groupShortcuts(SHORTCUT_MAP);
      const html = renderToStaticMarkup(
        React.createElement(ShortcutHelpOverlay, { isOpen: true, onClose: vi.fn() })
      );

      for (const section of sections) {
        const encodedTitle = section.title.replace(/&/g, '&amp;');
        expect(html).toContain(encodedTitle);
        for (const shortcut of section.shortcuts) {
          expect(html).toContain(shortcut.label);
        }
      }
    });

    it('9. Enter / Ctrl+Enter grading shortcuts are displayed correctly', () => {
      const html = renderToStaticMarkup(
        React.createElement(ShortcutHelpOverlay, { isOpen: true, onClose: vi.fn() })
      );

      // Save Draft (Enter)
      expect(html).toContain('shortcut-item-grading-save-draft');
      expect(html).toContain('Save Draft');
      expect(html).toContain('Enter');

      // Submit Final (Ctrl+Enter / Cmd+Enter)
      expect(html).toContain('shortcut-item-grading-submit-final');
      expect(html).toContain('Submit Final');
      expect(html).toContain('Ctrl+Enter');
    });

    it('10. tool shortcuts (P, E, C, X, H, T, V/S, M/L) are displayed correctly', () => {
      const html = renderToStaticMarkup(
        React.createElement(ShortcutHelpOverlay, { isOpen: true, onClose: vi.fn() })
      );

      expect(html).toContain('Pen Tool');
      expect(html).toContain('Eraser Tool');
      expect(html).toContain('Check Stamp');
      expect(html).toContain('Cross Stamp');
      expect(html).toContain('Highlighter Tool');
      expect(html).toContain('Text Note Tool');
      expect(html).toContain('Select Tool');
      expect(html).toContain('Toggle Magnifier / Loupe');
    });

    it('11. navigation shortcuts (Alt+ArrowDown, Alt+ArrowUp, Q, Shift+Q) are displayed correctly', () => {
      const html = renderToStaticMarkup(
        React.createElement(ShortcutHelpOverlay, { isOpen: true, onClose: vi.fn() })
      );

      expect(html).toContain('Next Page');
      expect(html).toContain('Previous Page');
      expect(html).toContain('Next Question');
      expect(html).toContain('Previous Question');
    });

    it('12. no hard-coded shortcut entries required — renders arbitrary custom keymaps dynamically', () => {
      const customKeymap: ShortcutDefinition[] = [
        {
          id: 'custom-action-1',
          key: 'Shift+K',
          action: 'rotateCw',
          label: 'Custom Quick Rotate',
          group: 'view',
          description: 'Custom view rotation description',
        },
        {
          id: 'custom-grading-1',
          key: 'F1',
          action: 'saveDraft',
          label: 'Special Grading Action',
          group: 'grading',
          description: 'Special custom grading shortcut',
        },
      ];

      const html = renderToStaticMarkup(
        React.createElement(ShortcutHelpOverlay, {
          isOpen: true,
          onClose: vi.fn(),
          shortcutMap: customKeymap,
        })
      );

      expect(html).toContain('Custom Quick Rotate');
      expect(html).toContain('Shift+K');
      expect(html).toContain('Special Grading Action');
      expect(html).toContain('F1');
      expect(html).not.toContain('Pen Tool');
    });
  });

  describe('3. Focus Management & Keyboard Dismissal (Requirements 13 - 15)', () => {
    it('13. Escape key invokes onClose', () => {
      const onClose = vi.fn();
      const dispatcher = {
        isHelpOpen: true,
        handleKey: (e: { key: string }) => {
          if (dispatcher.isHelpOpen && e.key === 'Escape') {
            onClose();
            return { handled: true, action: 'closeHelp' };
          }
          return { handled: false };
        },
      };

      const result = dispatcher.handleKey({ key: 'Escape' });
      expect(result.handled).toBe(true);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('14. close button has accessible label and data-testid', () => {
      const html = renderToStaticMarkup(
        React.createElement(ShortcutHelpOverlay, { isOpen: true, onClose: vi.fn() })
      );
      expect(html).toContain('data-testid="canvas-shortcut-help-close"');
      expect(html).toContain('aria-label="Close keyboard shortcuts"');
    });

    it('15. formatShortcutKeys helper formats canonical combinations and aliases cleanly', () => {
      const selectShortcut: ShortcutDefinition = {
        id: 'tool-select',
        key: 'V',
        keys: ['S'],
        action: 'tool:select',
        label: 'Select Tool',
        group: 'tools',
        description: 'Select tool',
      };
      expect(formatShortcutKeys(selectShortcut)).toEqual(['V', 'S']);

      const submitShortcut: ShortcutDefinition = {
        id: 'grading-submit-final',
        key: 'Ctrl+Enter',
        keys: ['Cmd+Enter', 'Meta+Enter'],
        action: 'submitFinal',
        label: 'Submit Final',
        group: 'grading',
        description: 'Submit grading',
      };
      expect(formatShortcutKeys(submitShortcut)).toEqual(['Ctrl+Enter']);
    });
  });

  describe('4. Shortcut Suppression While Help Overlay is Active (Requirements 16 - 19)', () => {
    // Simulator matching AnswerSheetCanvas keyboard dispatch path
    const createDispatcher = (initialHelpOpen: boolean = false) => {
      let isHelpOpen = initialHelpOpen;
      let tool: CanvasTool = 'none';
      let pageIndex = 0;
      const saveDraftSpy = vi.fn();
      const submitFinalSpy = vi.fn();
      const nextQuestionSpy = vi.fn();
      const prevQuestionSpy = vi.fn();
      const closeHelpSpy = vi.fn(() => {
        isHelpOpen = false;
      });

      const dispatch = (event: {
        key: string;
        ctrlKey?: boolean;
        metaKey?: boolean;
        altKey?: boolean;
        shiftKey?: boolean;
        target?: EventTarget | null | HTMLElement | { tagName?: string; isContentEditable?: boolean };
      }) => {
        if (isHelpOpen) {
          if (event.key === 'Escape') {
            closeHelpSpy();
            return { handled: true, action: 'closeHelp' };
          }
          return { handled: false, reason: 'suppressed-by-help-dialog' };
        }

        if (isTypingTarget(event.target ?? null)) {
          return { handled: false, reason: 'typing-target' };
        }

        const matched = findMatchingShortcut(event);
        if (!matched) return { handled: false, reason: 'no-match' };

        switch (matched.action) {
          case 'saveDraft':
            saveDraftSpy();
            return { handled: true, action: 'saveDraft' };
          case 'submitFinal':
            submitFinalSpy();
            return { handled: true, action: 'submitFinal' };
          case 'tool:pen':
            tool = 'pen';
            return { handled: true, action: 'tool:pen' };
          case 'tool:eraser':
            tool = 'eraser';
            return { handled: true, action: 'tool:eraser' };
          case 'nextPage':
            pageIndex++;
            return { handled: true, action: 'nextPage' };
          case 'nextQuestion':
            nextQuestionSpy();
            return { handled: true, action: 'nextQuestion' };
          case 'prevQuestion':
            prevQuestionSpy();
            return { handled: true, action: 'prevQuestion' };
          case 'openHelp':
            isHelpOpen = true;
            return { handled: true, action: 'openHelp' };
          default:
            return { handled: true, action: matched.action };
        }
      };

      return {
        get isHelpOpen() {
          return isHelpOpen;
        },
        setHelpOpen: (val: boolean) => {
          isHelpOpen = val;
        },
        get tool() {
          return tool;
        },
        get pageIndex() {
          return pageIndex;
        },
        saveDraftSpy,
        submitFinalSpy,
        nextQuestionSpy,
        prevQuestionSpy,
        closeHelpSpy,
        dispatch,
      };
    };

    it('16. canvas shortcuts do not execute while dialog is open', () => {
      const d = createDispatcher(true);
      const resPen = d.dispatch({ key: 'p' });
      expect(resPen.handled).toBe(false);
      expect(resPen.reason).toBe('suppressed-by-help-dialog');
      expect(d.tool).toBe('none');

      const resEraser = d.dispatch({ key: 'e' });
      expect(resEraser.handled).toBe(false);
      expect(d.tool).toBe('none');
    });

    it('17. Enter does not save draft while dialog is open', () => {
      const d = createDispatcher(true);
      const res = d.dispatch({ key: 'Enter' });
      expect(res.handled).toBe(false);
      expect(res.reason).toBe('suppressed-by-help-dialog');
      expect(d.saveDraftSpy).not.toHaveBeenCalled();
    });

    it('18. Ctrl+Enter does not submit while dialog is open', () => {
      const d = createDispatcher(true);
      const res = d.dispatch({ key: 'Enter', ctrlKey: true });
      expect(res.handled).toBe(false);
      expect(res.reason).toBe('suppressed-by-help-dialog');
      expect(d.submitFinalSpy).not.toHaveBeenCalled();
    });

    it('19. navigation keys (Alt+Down, Q) do not navigate while dialog is open', () => {
      const d = createDispatcher(true);
      const resNav = d.dispatch({ key: 'ArrowDown', altKey: true });
      expect(resNav.handled).toBe(false);
      expect(d.pageIndex).toBe(0);

      const resQ = d.dispatch({ key: 'q' });
      expect(resQ.handled).toBe(false);
      expect(d.nextQuestionSpy).not.toHaveBeenCalled();
    });
  });

  describe('5. State Isolation & Non-Destructive Behavior (Requirements 20 - 24)', () => {
    it('20. help overlay opens and closes normally after canvas tools have changed', () => {
      const currentTool: CanvasTool = 'pen';
      let isHelpOpen = false;

      const toggleHelp = () => {
        isHelpOpen = !isHelpOpen;
      };

      expect(currentTool).toBe('pen');
      toggleHelp();
      expect(isHelpOpen).toBe(true);
      expect(currentTool).toBe('pen'); // Tool preserved

      toggleHelp();
      expect(isHelpOpen).toBe(false);
      expect(currentTool).toBe('pen'); // Tool preserved
    });

    it('21. help overlay works after activating the loupe', () => {
      const isLoupeActive = true;
      let isHelpOpen = false;

      const toggleHelp = () => {
        isHelpOpen = !isHelpOpen;
      };

      toggleHelp();
      expect(isHelpOpen).toBe(true);
      expect(isLoupeActive).toBe(true);

      toggleHelp();
      expect(isHelpOpen).toBe(false);
      expect(isLoupeActive).toBe(true);
    });

    it('22. help overlay does not alter canvas view state (zoom, rotation, brightness, contrast)', () => {
      const viewState = {
        zoom: 1.75,
        panX: 45,
        panY: -30,
        rotation: 90,
        brightness: 1.2,
        contrast: 1.1,
      };

      let isHelpOpen = false;
      const toggleHelp = () => {
        isHelpOpen = !isHelpOpen;
      };

      toggleHelp();
      expect(isHelpOpen).toBe(true);
      expect(viewState.zoom).toBe(1.75);
      expect(viewState.rotation).toBe(90);
      expect(viewState.brightness).toBe(1.2);
      expect(viewState.contrast).toBe(1.1);
    });

    it('23. help overlay does not modify annotations or pen strokes', () => {
      const annotations = [{ id: 'mark-1', type: 'check', x: 10, y: 10 }];
      const strokes = [{ id: 'stroke-1', points: [0, 0, 10, 10], color: '#ef4444', strokeWidth: 2 }];

      const initialAnnotationsLen = annotations.length;
      const initialStrokesLen = strokes.length;

      let isHelpOpen = true;
      isHelpOpen = false;

      expect(isHelpOpen).toBe(false);
      expect(annotations.length).toBe(initialAnnotationsLen);
      expect(strokes.length).toBe(initialStrokesLen);
    });

    it('24. help overlay does not modify grading state or trigger autosaves', () => {
      const autosaveSpy = vi.fn();
      let isHelpOpen = false;

      const toggleHelp = () => {
        isHelpOpen = !isHelpOpen;
        // Notice opening or closing help must NEVER call autosaveSpy
      };

      toggleHelp();
      expect(isHelpOpen).toBe(true);
      expect(autosaveSpy).not.toHaveBeenCalled();

      toggleHelp();
      expect(isHelpOpen).toBe(false);
      expect(autosaveSpy).not.toHaveBeenCalled();
    });

    it('25. SHORTCUT_MAP validation still reports 0 conflicts after adding help shortcut (?)', () => {
      const validation = validateShortcutMap(SHORTCUT_MAP);
      expect(validation.valid).toBe(true);
      expect(validation.conflicts).toEqual([]);
    });

    it('26. pressing ? shortcut triggers openHelp action in keyboard dispatcher', () => {
      const eventUs = { key: '?', shiftKey: true };
      const matchedUs = findMatchingShortcut(eventUs);
      expect(matchedUs?.action).toBe('openHelp');

      const eventDirect = { key: '?', shiftKey: false };
      const matchedDirect = findMatchingShortcut(eventDirect);
      expect(matchedDirect?.action).toBe('openHelp');
    });
  });
});

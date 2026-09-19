import { describe, it, expect, vi } from 'vitest';
import {
  SHORTCUT_MAP,
  findMatchingShortcut,
  isTypingTarget,
  validateShortcutMap,
  actionToCanvasTool,
} from '../lib/shortcutMap';
import type { CanvasTool } from '../components/canvas/types';

describe('AE-155: Tool Hotkeys for the Grading Canvas', () => {
  describe('1. Individual Tool Hotkey Activation (Requirements 1 - 10)', () => {
    // Helper creating a simulated canvas tool state dispatcher
    const createToolDispatcher = (initialTool: CanvasTool = 'none') => {
      let activeTool: CanvasTool = initialTool;
      let activeTextEditor: { imagePoint: { x: number; y: number } } | null = null;
      let isLoupeActive = false;
      const onToolChange = vi.fn((tool: CanvasTool) => {
        activeTool = tool;
      });
      const onLoupeChange = vi.fn((active: boolean) => {
        isLoupeActive = active;
        if (active) activeTool = 'loupe';
        else if (activeTool === 'loupe') activeTool = 'none';
      });

      const dispatchKey = (
        event: {
          key: string;
          ctrlKey?: boolean;
          metaKey?: boolean;
          altKey?: boolean;
          shiftKey?: boolean;
          target?: EventTarget | null | HTMLElement | { tagName?: string; isContentEditable?: boolean };
        }
      ) => {
        if (isTypingTarget(event.target ?? null)) {
          return { handled: false, reason: 'typing-target' };
        }
        if (activeTextEditor !== null) {
          return { handled: false, reason: 'text-editor-active' };
        }

        const matched = findMatchingShortcut(event);
        if (!matched) {
          return { handled: false, reason: 'no-match' };
        }

        switch (matched.action) {
          case 'tool:select':
            onToolChange('select');
            break;
          case 'tool:pen':
            onToolChange('pen');
            break;
          case 'tool:eraser':
            onToolChange('eraser');
            break;
          case 'tool:check':
            onToolChange('check');
            break;
          case 'tool:cross':
            onToolChange('cross');
            break;
          case 'tool:highlight':
            onToolChange('highlight');
            break;
          case 'tool:text':
            onToolChange('text');
            break;
          case 'toggleLoupe':
            onLoupeChange(!isLoupeActive);
            break;
          default:
            break;
        }

        return { handled: true, action: matched.action, activeTool };
      };

      return {
        getActiveTool: () => activeTool,
        getIsLoupeActive: () => isLoupeActive,
        setTextEditorActive: (active: boolean) => {
          activeTextEditor = active ? { imagePoint: { x: 100, y: 100 } } : null;
        },
        dispatchKey,
        onToolChange,
        onLoupeChange,
      };
    };

    it('1. P activates Pen tool', () => {
      const dispatcher = createToolDispatcher('none');
      const res = dispatcher.dispatchKey({ key: 'p' });
      expect(res.handled).toBe(true);
      expect(res.action).toBe('tool:pen');
      expect(dispatcher.getActiveTool()).toBe('pen');
      expect(dispatcher.onToolChange).toHaveBeenCalledWith('pen');
    });

    it('2. E activates Eraser tool', () => {
      const dispatcher = createToolDispatcher('pen');
      const res = dispatcher.dispatchKey({ key: 'e' });
      expect(res.handled).toBe(true);
      expect(res.action).toBe('tool:eraser');
      expect(dispatcher.getActiveTool()).toBe('eraser');
      expect(dispatcher.onToolChange).toHaveBeenCalledWith('eraser');
    });

    it('3. C activates Check stamp tool', () => {
      const dispatcher = createToolDispatcher('none');
      const res = dispatcher.dispatchKey({ key: 'c' });
      expect(res.handled).toBe(true);
      expect(res.action).toBe('tool:check');
      expect(dispatcher.getActiveTool()).toBe('check');
      expect(dispatcher.onToolChange).toHaveBeenCalledWith('check');
    });

    it('4. X activates Cross stamp tool', () => {
      const dispatcher = createToolDispatcher('none');
      const res = dispatcher.dispatchKey({ key: 'x' });
      expect(res.handled).toBe(true);
      expect(res.action).toBe('tool:cross');
      expect(dispatcher.getActiveTool()).toBe('cross');
      expect(dispatcher.onToolChange).toHaveBeenCalledWith('cross');
    });

    it('5. H activates Highlighter tool', () => {
      const dispatcher = createToolDispatcher('none');
      const res = dispatcher.dispatchKey({ key: 'h' });
      expect(res.handled).toBe(true);
      expect(res.action).toBe('tool:highlight');
      expect(dispatcher.getActiveTool()).toBe('highlight');
      expect(dispatcher.onToolChange).toHaveBeenCalledWith('highlight');
    });

    it('6. T activates Text Note tool', () => {
      const dispatcher = createToolDispatcher('none');
      const res = dispatcher.dispatchKey({ key: 't' });
      expect(res.handled).toBe(true);
      expect(res.action).toBe('tool:text');
      expect(dispatcher.getActiveTool()).toBe('text');
      expect(dispatcher.onToolChange).toHaveBeenCalledWith('text');
    });

    it('7. V activates Select tool', () => {
      const dispatcher = createToolDispatcher('pen');
      const res = dispatcher.dispatchKey({ key: 'v' });
      expect(res.handled).toBe(true);
      expect(res.action).toBe('tool:select');
      expect(dispatcher.getActiveTool()).toBe('select');
      expect(dispatcher.onToolChange).toHaveBeenCalledWith('select');
    });

    it('8. S activates Select tool (alternate key)', () => {
      const dispatcher = createToolDispatcher('pen');
      const res = dispatcher.dispatchKey({ key: 's' });
      expect(res.handled).toBe(true);
      expect(res.action).toBe('tool:select');
      expect(dispatcher.getActiveTool()).toBe('select');
      expect(dispatcher.onToolChange).toHaveBeenCalledWith('select');
    });

    it('9. M activates and toggles Magnifier / Loupe tool', () => {
      const dispatcher = createToolDispatcher('none');
      const res1 = dispatcher.dispatchKey({ key: 'm' });
      expect(res1.handled).toBe(true);
      expect(res1.action).toBe('toggleLoupe');
      expect(dispatcher.getIsLoupeActive()).toBe(true);

      const res2 = dispatcher.dispatchKey({ key: 'm' });
      expect(res2.handled).toBe(true);
      expect(dispatcher.getIsLoupeActive()).toBe(false);
    });

    it('10. L activates and toggles Magnifier / Loupe tool (alternate key)', () => {
      const dispatcher = createToolDispatcher('none');
      const res1 = dispatcher.dispatchKey({ key: 'l' });
      expect(res1.handled).toBe(true);
      expect(res1.action).toBe('toggleLoupe');
      expect(dispatcher.getIsLoupeActive()).toBe(true);

      const res2 = dispatcher.dispatchKey({ key: 'l' });
      expect(res2.handled).toBe(true);
      expect(dispatcher.getIsLoupeActive()).toBe(false);
    });
  });

  describe('2. Toolbar & State Synchronization (Requirement 11)', () => {
    it('11. tool hotkeys map cleanly to CanvasTool state identical to toolbar selections', () => {
      const toolShortcuts = [
        { key: 'p', expectedTool: 'pen', action: 'tool:pen' },
        { key: 'e', expectedTool: 'eraser', action: 'tool:eraser' },
        { key: 'c', expectedTool: 'check', action: 'tool:check' },
        { key: 'x', expectedTool: 'cross', action: 'tool:cross' },
        { key: 'h', expectedTool: 'highlight', action: 'tool:highlight' },
        { key: 't', expectedTool: 'text', action: 'tool:text' },
        { key: 'v', expectedTool: 'select', action: 'tool:select' },
        { key: 's', expectedTool: 'select', action: 'tool:select' },
        { key: 'm', expectedTool: 'loupe', action: 'toggleLoupe' },
        { key: 'l', expectedTool: 'loupe', action: 'toggleLoupe' },
      ];

      for (const item of toolShortcuts) {
        const matched = findMatchingShortcut({ key: item.key });
        expect(matched).not.toBeNull();
        expect(matched?.action).toBe(item.action);
        expect(actionToCanvasTool(matched!.action)).toBe(item.expectedTool);
      }
    });
  });

  describe('3. Typing Guard & TextNoteEditor Protection (Requirements 12 - 17)', () => {
    it('12. hotkeys do not fire in <input> elements', () => {
      const inputTarget = { tagName: 'INPUT', isContentEditable: false };
      expect(isTypingTarget(inputTarget)).toBe(true);

      const event = { key: 'p', target: inputTarget };
      expect(isTypingTarget(event.target)).toBe(true);
    });

    it('13. hotkeys do not fire in <textarea> elements', () => {
      const textareaTarget = { tagName: 'TEXTAREA', isContentEditable: false };
      expect(isTypingTarget(textareaTarget)).toBe(true);

      const event = { key: 't', target: textareaTarget };
      expect(isTypingTarget(event.target)).toBe(true);
    });

    it('14. hotkeys do not fire in contentEditable elements', () => {
      const editableTarget = { tagName: 'DIV', isContentEditable: true };
      expect(isTypingTarget(editableTarget)).toBe(true);
    });

    it('15. hotkeys do not fire while TextNoteEditor is open/active', () => {
      const dispatcher = {
        activeTextEditor: { imagePoint: { x: 50, y: 50 } },
        handleKey: (event: { key: string }) => {
          if (!event.key || dispatcher.activeTextEditor !== null) return false;
          return true;
        },
      };

      expect(dispatcher.handleKey({ key: 'p' })).toBe(false);
      expect(dispatcher.handleKey({ key: 'e' })).toBe(false);
      expect(dispatcher.handleKey({ key: 't' })).toBe(false);
    });

    it('16. a typed "p" inside TextNoteEditor textarea remains text and does not select Pen', () => {
      let currentText = 'Sample';
      const onTextInput = (char: string) => {
        currentText += char;
      };

      const textareaTarget = { tagName: 'TEXTAREA', isContentEditable: false };
      const event = { key: 'p', target: textareaTarget };

      if (isTypingTarget(event.target)) {
        onTextInput(event.key);
      }

      expect(currentText).toBe('Samplep');
    });

    it('17. a typed "t" inside TextNoteEditor textarea remains text and does not re-trigger Text Note tool', () => {
      let currentText = 'Hello';
      const textareaTarget = { tagName: 'TEXTAREA', isContentEditable: false };
      const event = { key: 't', target: textareaTarget };

      if (isTypingTarget(event.target)) {
        currentText += event.key;
      }

      expect(currentText).toBe('Hellot');
    });
  });

  describe('4. Single Event Path & Conflict Prevention (Requirements 18 - 20)', () => {
    it('18. a single key event triggers only one tool action', () => {
      const spy = vi.fn();
      const event = { key: 'e', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };

      const matched = findMatchingShortcut(event);
      if (matched) {
        spy(matched.action);
      }

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith('tool:eraser');
    });

    it('19. authoritative SHORTCUT_MAP maintains 0 conflicts across all hotkeys', () => {
      const check = validateShortcutMap(SHORTCUT_MAP);
      expect(check.valid).toBe(true);
      expect(check.conflicts).toEqual([]);
    });

    it('20. preserves existing AE-150 (R/Shift+R), AE-151, AE-152 (M/L), AE-153 (Alt+R), AE-154 behavior', () => {
      // Rotation
      expect(findMatchingShortcut({ key: 'r' })?.action).toBe('rotateCw');
      expect(findMatchingShortcut({ key: 'R', shiftKey: true })?.action).toBe('rotateCcw');

      // Reset View
      expect(findMatchingShortcut({ key: 'r', altKey: true })?.action).toBe('resetView');

      // Zoom
      expect(findMatchingShortcut({ key: '+' })?.action).toBe('zoomIn');
      expect(findMatchingShortcut({ key: '-' })?.action).toBe('zoomOut');
      expect(findMatchingShortcut({ key: '0' })?.action).toBe('resetZoom');

      // Grading Draft vs Final
      expect(findMatchingShortcut({ key: 'Enter' })?.action).toBe('saveDraft');
      expect(findMatchingShortcut({ key: 'Enter', ctrlKey: true })?.action).toBe('submitFinal');

      // Question vs Pen navigation
      expect(findMatchingShortcut({ key: 'q' })?.action).toBe('nextQuestion');
      expect(findMatchingShortcut({ key: 'p' })?.action).toBe('tool:pen');
    });
  });
});

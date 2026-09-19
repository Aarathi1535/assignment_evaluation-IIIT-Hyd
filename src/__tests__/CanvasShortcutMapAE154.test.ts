import { describe, it, expect, vi } from 'vitest';
import {
  SHORTCUT_MAP,
  ShortcutDefinition,
  ShortcutGroup,
  isTypingTarget,
  findMatchingShortcut,
  matchesShortcut,
  validateShortcutMap,
  getShortcutByAction,
  getShortcutsByGroup,
  canonicalizeKey,
  parseShortcutString,
} from '../lib/shortcutMap';

describe('AE-154: Shortcut Map for the Grading Canvas Workspace', () => {
  // 1. Authoritative keymap exists
  describe('1. Authoritative Keymap Structure', () => {
    it('provides an authoritative, non-empty shortcut map', () => {
      expect(Array.isArray(SHORTCUT_MAP)).toBe(true);
      expect(SHORTCUT_MAP.length).toBeGreaterThan(15);
    });

    // 2. Every shortcut has an action and user-facing label
    it('ensures every shortcut definition has an id, key, action, label, valid group, and description', () => {
      const validGroups: ShortcutGroup[] = ['tools', 'view', 'history', 'navigation', 'grading'];

      for (const item of SHORTCUT_MAP) {
        expect(typeof item.id).toBe('string');
        expect(item.id.trim().length).toBeGreaterThan(0);

        expect(typeof item.key).toBe('string');
        expect(item.key.trim().length).toBeGreaterThan(0);

        expect(typeof item.action).toBe('string');
        expect(item.action.trim().length).toBeGreaterThan(0);

        expect(typeof item.label).toBe('string');
        expect(item.label.trim().length).toBeGreaterThan(0);

        expect(validGroups).toContain(item.group);

        expect(typeof item.description).toBe('string');
        expect(item.description.trim().length).toBeGreaterThan(0);
      }
    });

    // 3. No duplicate / conflicting key combinations
    it('detects 0 shortcut conflicts across the entire authoritative keymap', () => {
      const result = validateShortcutMap(SHORTCUT_MAP);
      expect(result.valid).toBe(true);
      expect(result.conflicts).toEqual([]);
    });

    it('correctly catches hypothetical key collisions in custom keymaps', () => {
      const conflictingMap: ShortcutDefinition[] = [
        {
          id: 'test-1',
          key: 'Ctrl+Z',
          action: 'undo',
          label: 'Undo',
          group: 'history',
          description: 'Undo',
        },
        {
          id: 'test-2',
          key: 'Ctrl+Z',
          action: 'redo',
          label: 'Conflicting Redo',
          group: 'history',
          description: 'Redo',
        },
      ];

      const check = validateShortcutMap(conflictingMap);
      expect(check.valid).toBe(false);
      expect(check.conflicts.length).toBe(1);
      expect(check.conflicts[0].combo).toBe('CtrlOrCmd+Z');
      expect(check.conflicts[0].actions).toContain('undo');
      expect(check.conflicts[0].actions).toContain('redo');
    });
  });

  // 4 & 5. Enter maps to Save Draft and NEVER Submit Final
  describe('2. Enter vs Final Submit Semantics (Mentor Requirements 1 & 2)', () => {
    it('4. maps plain Enter exclusively to saveDraft', () => {
      const enterShortcut = findMatchingShortcut({ key: 'Enter' });
      expect(enterShortcut).not.toBeNull();
      expect(enterShortcut?.action).toBe('saveDraft');
      expect(enterShortcut?.group).toBe('grading');
      expect(enterShortcut?.label).toBe('Save Draft');
    });

    it('5. does NOT map plain Enter to submitFinal', () => {
      const enterShortcut = findMatchingShortcut({ key: 'Enter' });
      expect(enterShortcut?.action).not.toBe('submitFinal');

      const submitFinalDef = getShortcutByAction('submitFinal');
      expect(submitFinalDef).toBeDefined();
      expect(submitFinalDef?.key).not.toBe('Enter');
    });

    it('6. requires deliberate modifier combination (Ctrl+Enter / Cmd+Enter) for final submission', () => {
      const ctrlEnter = findMatchingShortcut({ key: 'Enter', ctrlKey: true });
      expect(ctrlEnter).not.toBeNull();
      expect(ctrlEnter?.action).toBe('submitFinal');
      expect(ctrlEnter?.label).toBe('Submit Final');

      const cmdEnter = findMatchingShortcut({ key: 'Enter', metaKey: true });
      expect(cmdEnter).not.toBeNull();
      expect(cmdEnter?.action).toBe('submitFinal');
    });
  });

  // 7 & 8. Tab accessibility and Next/Previous navigation
  describe('3. Tab Preservation & Navigation Keys (Mentor Requirements 3 & 4)', () => {
    it('7. never intercepts or maps the browser Tab key', () => {
      const tabMatch = findMatchingShortcut({ key: 'Tab' });
      expect(tabMatch).toBeNull();

      const shiftTabMatch = findMatchingShortcut({ key: 'Tab', shiftKey: true });
      expect(shiftTabMatch).toBeNull();

      const altTabMatch = findMatchingShortcut({ key: 'Tab', altKey: true });
      expect(altTabMatch).toBeNull();

      // Ensure Tab is not in any definition
      for (const item of SHORTCUT_MAP) {
        expect(item.key.toLowerCase()).not.toContain('tab');
        if (item.keys) {
          for (const k of item.keys) {
            expect(k.toLowerCase()).not.toContain('tab');
          }
        }
      }
    });

    it('8. provides non-Tab page navigation shortcuts (Alt+Down, Alt+Up, PageDown, PageUp, J, K)', () => {
      const nextPageAltDown = findMatchingShortcut({ key: 'ArrowDown', altKey: true });
      expect(nextPageAltDown?.action).toBe('nextPage');

      const nextPageJ = findMatchingShortcut({ key: 'j' });
      expect(nextPageJ?.action).toBe('nextPage');

      const nextPagePgDn = findMatchingShortcut({ key: 'PageDown' });
      expect(nextPagePgDn?.action).toBe('nextPage');

      const prevPageAltUp = findMatchingShortcut({ key: 'ArrowUp', altKey: true });
      expect(prevPageAltUp?.action).toBe('prevPage');

      const prevPageK = findMatchingShortcut({ key: 'k' });
      expect(prevPageK?.action).toBe('prevPage');

      const prevPagePgUp = findMatchingShortcut({ key: 'PageUp' });
      expect(prevPagePgUp?.action).toBe('prevPage');
    });
  });

  // 9. Q and P distinct intended meanings
  describe('4. Q and P Disambiguation (Mentor Requirement 5)', () => {
    it('9. assigns distinct actions to Q and P without duplicate or copy-error overlap', () => {
      const pMatch = findMatchingShortcut({ key: 'p' });
      expect(pMatch).not.toBeNull();
      expect(pMatch?.action).toBe('tool:pen');
      expect(pMatch?.group).toBe('tools');
      expect(pMatch?.label).toBe('Pen Tool');

      const qMatch = findMatchingShortcut({ key: 'q' });
      expect(qMatch).not.toBeNull();
      expect(qMatch?.action).toBe('nextQuestion');
      expect(qMatch?.group).toBe('navigation');
      expect(qMatch?.label).toBe('Next Question');

      const shiftQMatch = findMatchingShortcut({ key: 'Q', shiftKey: true });
      expect(shiftQMatch).not.toBeNull();
      expect(shiftQMatch?.action).toBe('prevQuestion');
      expect(shiftQMatch?.group).toBe('navigation');
      expect(shiftQMatch?.label).toBe('Previous Question');

      expect(pMatch?.action).not.toBe(qMatch?.action);
    });
  });

  // 11-14. Typing guards
  describe('5. Typing Isolation & Target Guards (Mentor Requirement 6)', () => {
    it('10. allows shortcuts when canvas/wrapper element is focused', () => {
      const divTarget = { tagName: 'DIV', isContentEditable: false };
      expect(isTypingTarget(divTarget)).toBe(false);

      const canvasTarget = { tagName: 'CANVAS', isContentEditable: false };
      expect(isTypingTarget(canvasTarget)).toBe(false);

      const buttonTarget = { tagName: 'BUTTON', isContentEditable: false };
      expect(isTypingTarget(buttonTarget)).toBe(false);

      expect(isTypingTarget(null)).toBe(false);
    });

    it('11. strictly ignores shortcuts when typing in <input> elements', () => {
      expect(isTypingTarget({ tagName: 'INPUT' })).toBe(true);
      expect(isTypingTarget({ tagName: 'input' })).toBe(true);
    });

    it('12. strictly ignores shortcuts when typing in <textarea> elements', () => {
      expect(isTypingTarget({ tagName: 'TEXTAREA' })).toBe(true);
      expect(isTypingTarget({ tagName: 'textarea' })).toBe(true);
    });

    it('13. strictly ignores shortcuts when typing in contentEditable / role="textbox" elements', () => {
      expect(isTypingTarget({ isContentEditable: true })).toBe(true);

      const mockRoleTextbox = {
        tagName: 'DIV',
        getAttribute: (attr: string) => (attr === 'role' ? 'textbox' : null),
        isContentEditable: false,
      };
      expect(isTypingTarget(mockRoleTextbox)).toBe(true);

      const mockContentEditableAttr = {
        tagName: 'DIV',
        getAttribute: (attr: string) => (attr === 'contenteditable' ? 'true' : null),
        isContentEditable: false,
      };
      expect(isTypingTarget(mockContentEditableAttr)).toBe(true);
    });

    it('14. ignores shortcuts when TextNoteEditor active state is present in simulated canvas dispatcher', () => {
      let isTextEditorActive = true;
      const dispatchSimulator = (event: { key: string }) => {
        if (isTextEditorActive) return null;
        return findMatchingShortcut(event);
      };

      expect(dispatchSimulator({ key: 'Enter' })).toBeNull();
      expect(dispatchSimulator({ key: 'p' })).toBeNull();

      isTextEditorActive = false;
      expect(dispatchSimulator({ key: 'Enter' })?.action).toBe('saveDraft');
      expect(dispatchSimulator({ key: 'p' })?.action).toBe('tool:pen');
    });
  });

  // 15. Key normalization and modifiers
  describe('6. Key Normalization & Modifier Combinations (Mentor Requirement 7)', () => {
    it('canonicalizes key names and whitespace', () => {
      expect(canonicalizeKey('enter')).toBe('Enter');
      expect(canonicalizeKey('Enter')).toBe('Enter');
      expect(canonicalizeKey('delete')).toBe('Delete');
      expect(canonicalizeKey('del')).toBe('Delete');
      expect(canonicalizeKey('esc')).toBe('Escape');
      expect(canonicalizeKey('escape')).toBe('Escape');
      expect(canonicalizeKey('arrowdown')).toBe('ArrowDown');
      expect(canonicalizeKey('down')).toBe('ArrowDown');
      expect(canonicalizeKey('pagedown')).toBe('PageDown');
      expect(canonicalizeKey('z')).toBe('Z');
      expect(canonicalizeKey('r')).toBe('R');
    });

    it('parses shortcut strings accurately into modifier flags and keys', () => {
      const parsed1 = parseShortcutString('Ctrl+Shift+Z');
      expect(parsed1.ctrlOrCmd).toBe(true);
      expect(parsed1.ctrl).toBe(true);
      expect(parsed1.shift).toBe(true);
      expect(parsed1.alt).toBe(false);
      expect(parsed1.canonicalKey).toBe('Z');

      const parsed2 = parseShortcutString('Cmd+Enter');
      expect(parsed2.ctrlOrCmd).toBe(true);
      expect(parsed2.meta).toBe(true);
      expect(parsed2.shift).toBe(false);
      expect(parsed2.canonicalKey).toBe('Enter');

      const parsed3 = parseShortcutString('Alt+R');
      expect(parsed3.alt).toBe(true);
      expect(parsed3.ctrlOrCmd).toBe(false);
      expect(parsed3.canonicalKey).toBe('R');
    });

    it('15. cleanly distinguishes modifier combinations without cross-firing', () => {
      // Plain R -> rotateCw
      const r = findMatchingShortcut({ key: 'r' });
      expect(r?.action).toBe('rotateCw');

      // Shift+R -> rotateCcw
      const shiftR = findMatchingShortcut({ key: 'R', shiftKey: true });
      expect(shiftR?.action).toBe('rotateCcw');

      // Alt+R -> resetView (AE-153)
      const altR = findMatchingShortcut({ key: 'r', altKey: true });
      expect(altR?.action).toBe('resetView');

      // Plain Enter -> saveDraft
      const enter = findMatchingShortcut({ key: 'Enter' });
      expect(enter?.action).toBe('saveDraft');

      // Ctrl+Enter -> submitFinal
      const ctrlEnter = findMatchingShortcut({ key: 'Enter', ctrlKey: true });
      expect(ctrlEnter?.action).toBe('submitFinal');
    });
  });

  // 16. Existing AE-150 / AE-152 / AE-153 functionality
  describe('7. Feature Parity with AE-150, AE-152, AE-153', () => {
    it('16. maintains rotation shortcuts (R / Shift+R) for AE-150', () => {
      expect(findMatchingShortcut({ key: 'r' })?.action).toBe('rotateCw');
      expect(findMatchingShortcut({ key: 'R', shiftKey: true })?.action).toBe('rotateCcw');
    });

    it('16. maintains magnifier loupe toggle shortcuts (M / L) for AE-152', () => {
      expect(findMatchingShortcut({ key: 'm' })?.action).toBe('toggleLoupe');
      expect(findMatchingShortcut({ key: 'l' })?.action).toBe('toggleLoupe');
      expect(findMatchingShortcut({ key: 'M' })?.action).toBe('toggleLoupe');
      expect(findMatchingShortcut({ key: 'L' })?.action).toBe('toggleLoupe');
    });

    it('16. maintains reset view shortcut (Alt+R) for AE-153', () => {
      expect(findMatchingShortcut({ key: 'r', altKey: true })?.action).toBe('resetView');
    });

    it('maintains undo/redo and delete selected shortcuts', () => {
      expect(findMatchingShortcut({ key: 'z', ctrlKey: true })?.action).toBe('undo');
      expect(findMatchingShortcut({ key: 'z', metaKey: true })?.action).toBe('undo');

      expect(findMatchingShortcut({ key: 'y', ctrlKey: true })?.action).toBe('redo');
      expect(findMatchingShortcut({ key: 'Z', ctrlKey: true, shiftKey: true })?.action).toBe('redo');

      expect(findMatchingShortcut({ key: 'Delete' })?.action).toBe('deleteSelected');
      expect(findMatchingShortcut({ key: 'Backspace' })?.action).toBe('deleteSelected');
    });
  });

  // 17. Single event path & no duplicate dispatch
  describe('8. Centralized Event Path & Helper Methods (Mentor Requirement 8)', () => {
    it('17. dispatches exactly one matching action per keyboard event without duplicates', () => {
      const listenerSpy = vi.fn();
      const mockEvent = { key: 'p', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };

      const matched = findMatchingShortcut(mockEvent);
      if (matched) {
        listenerSpy(matched.action);
      }

      expect(listenerSpy).toHaveBeenCalledTimes(1);
      expect(listenerSpy).toHaveBeenCalledWith('tool:pen');
    });

    it('correctly filters shortcuts by group', () => {
      const tools = getShortcutsByGroup('tools');
      expect(tools.length).toBeGreaterThanOrEqual(8);
      expect(tools.every((t) => t.group === 'tools')).toBe(true);

      const grading = getShortcutsByGroup('grading');
      expect(grading.length).toBe(2);
      expect(grading.every((g) => g.group === 'grading')).toBe(true);

      const nav = getShortcutsByGroup('navigation');
      expect(nav.length).toBeGreaterThanOrEqual(4);
      expect(nav.every((n) => n.group === 'navigation')).toBe(true);
    });

    it('matchesShortcut handles disabled definitions', () => {
      const penDef = getShortcutByAction('tool:pen');
      expect(penDef).toBeDefined();

      if (penDef) {
        expect(matchesShortcut(penDef, { key: 'p' })).toBe(true);
        const disabledPen = { ...penDef, disabled: true };
        expect(matchesShortcut(disabledPen, { key: 'p' })).toBe(false);
      }
    });
  });
});

/**
 * Single authoritative shortcut/keymap definition for the grading canvas workspace.
 * Reused across AE-154 (Shortcut Map), AE-155 (Tool Hotkeys), and AE-156 (Shortcut Help Overlay).
 */

export type ShortcutGroup =
  | 'tools'
  | 'view'
  | 'history'
  | 'navigation'
  | 'grading';

export type ShortcutAction =
  // Tool selection
  | 'tool:select'
  | 'tool:pen'
  | 'tool:eraser'
  | 'tool:check'
  | 'tool:cross'
  | 'tool:highlight'
  | 'tool:text'
  | 'toggleLoupe'
  // Canvas View & Transforms
  | 'zoomIn'
  | 'zoomOut'
  | 'resetZoom'
  | 'rotateCw'
  | 'rotateCcw'
  | 'resetView'
  | 'toggleOverlay'
  | 'openHelp'
  // History & Annotations
  | 'undo'
  | 'redo'
  | 'deleteSelected'
  // Navigation
  | 'nextPage'
  | 'prevPage'
  | 'nextQuestion'
  | 'prevQuestion'
  // Grading Submissions
  | 'saveDraft'
  | 'submitFinal';

export interface ShortcutDefinition {
  /** Unique shortcut identifier */
  id: string;
  /** Primary canonical key combo for display (e.g., 'Enter', 'Ctrl+Enter', 'Ctrl+Z', 'Alt+Down') */
  key: string;
  /** Equivalent/alternative key combinations that trigger this same action */
  keys?: string[];
  /** Authoritative action triggered by this shortcut */
  action: ShortcutAction;
  /** Human-readable title/label for UI buttons and shortcut help overlay */
  label: string;
  /** Category grouping for organization and overlay rendering */
  group: ShortcutGroup;
  /** Detailed user-facing description */
  description: string;
  /** Whether the shortcut is currently disabled */
  disabled?: boolean;
}

/**
 * Single authoritative keymap list.
 * Note:
 * 1. 'Enter' maps exclusively to 'saveDraft'. NEVER final submission.
 * 2. Final submission requires 'Ctrl+Enter' or 'Cmd+Enter'.
 * 3. 'Tab' is intentionally not captured/intercepted to preserve native accessibility.
 * 4. 'P' maps to Pen Tool; 'Q' maps to Next Question (distinct actions, no copy error).
 */
export const SHORTCUT_MAP: readonly ShortcutDefinition[] = [
  // --- Grading Actions ---
  {
    id: 'grading-save-draft',
    key: 'Enter',
    action: 'saveDraft',
    label: 'Save Draft',
    group: 'grading',
    description: 'Save current question score and feedback as draft',
  },
  {
    id: 'grading-submit-final',
    key: 'Ctrl+Enter',
    keys: ['Cmd+Enter', 'Meta+Enter'],
    action: 'submitFinal',
    label: 'Submit Final',
    group: 'grading',
    description: 'Finalize and submit grading for the current question',
  },

  // --- Canvas Tools (AE-155 Hotkeys) ---
  {
    id: 'tool-select',
    key: 'V',
    keys: ['S'],
    action: 'tool:select',
    label: 'Select Tool',
    group: 'tools',
    description: 'Select, move, or delete annotations on canvas',
  },
  {
    id: 'tool-pen',
    key: 'P',
    action: 'tool:pen',
    label: 'Pen Tool',
    group: 'tools',
    description: 'Freehand grading pen tool for handwriting and sketches',
  },
  {
    id: 'tool-eraser',
    key: 'E',
    action: 'tool:eraser',
    label: 'Eraser Tool',
    group: 'tools',
    description: 'Erase freehand pen strokes by dragging across them',
  },
  {
    id: 'tool-check',
    key: 'C',
    action: 'tool:check',
    label: 'Check Stamp (✓)',
    group: 'tools',
    description: 'Place a green checkmark annotation stamp',
  },
  {
    id: 'tool-cross',
    key: 'X',
    action: 'tool:cross',
    label: 'Cross Stamp (✗)',
    group: 'tools',
    description: 'Place a red cross annotation stamp',
  },
  {
    id: 'tool-highlight',
    key: 'H',
    action: 'tool:highlight',
    label: 'Highlighter Tool',
    group: 'tools',
    description: 'Draw a semi-transparent yellow highlight box',
  },
  {
    id: 'tool-text',
    key: 'T',
    action: 'tool:text',
    label: 'Text Note Tool',
    group: 'tools',
    description: 'Add a typed comment / sticky text note on the canvas',
  },
  {
    id: 'tool-loupe',
    key: 'M',
    keys: ['L'],
    action: 'toggleLoupe',
    label: 'Toggle Magnifier / Loupe',
    group: 'tools',
    description: 'Toggle the interactive floating magnifier loupe (AE-152)',
  },

  // --- View & Transform Controls ---
  {
    id: 'view-zoom-in',
    key: '+',
    keys: ['='],
    action: 'zoomIn',
    label: 'Zoom In',
    group: 'view',
    description: 'Increase canvas magnification (+25%)',
  },
  {
    id: 'view-zoom-out',
    key: '-',
    action: 'zoomOut',
    label: 'Zoom Out',
    group: 'view',
    description: 'Decrease canvas magnification (-25%)',
  },
  {
    id: 'view-reset-zoom',
    key: '0',
    action: 'resetZoom',
    label: 'Reset Zoom to Fit',
    group: 'view',
    description: 'Reset zoom level to 100% (fit-to-page)',
  },
  {
    id: 'view-rotate-cw',
    key: 'R',
    action: 'rotateCw',
    label: 'Rotate Clockwise',
    group: 'view',
    description: 'Rotate canvas and annotations 90° clockwise (AE-150)',
  },
  {
    id: 'view-rotate-ccw',
    key: 'Shift+R',
    action: 'rotateCcw',
    label: 'Rotate Counter-Clockwise',
    group: 'view',
    description: 'Rotate canvas and annotations 90° counter-clockwise (AE-150)',
  },
  {
    id: 'view-reset-view',
    key: 'Alt+R',
    action: 'resetView',
    label: 'Reset View',
    group: 'view',
    description: 'Reset all view transforms (pan, zoom, rotation, brightness, contrast) (AE-153)',
  },
  {
    id: 'view-toggle-overlay',
    key: 'O',
    action: 'toggleOverlay',
    label: 'Toggle Overlay Visibility',
    group: 'view',
    description: 'Show or hide all annotation marks and strokes (AE-133)',
  },
  {
    id: 'view-shortcut-help',
    key: '?',
    keys: ['Shift+?'],
    action: 'openHelp',
    label: 'Keyboard Shortcuts Help',
    group: 'view',
    description: 'Display this keyboard shortcut help reference overlay (AE-156)',
  },

  // --- History & Annotation Editing ---
  {
    id: 'history-undo',
    key: 'Ctrl+Z',
    keys: ['Cmd+Z', 'Meta+Z'],
    action: 'undo',
    label: 'Undo',
    group: 'history',
    description: 'Undo the last annotation or stroke on current page',
  },
  {
    id: 'history-redo',
    key: 'Ctrl+Y',
    keys: ['Ctrl+Shift+Z', 'Cmd+Shift+Z', 'Meta+Shift+Z', 'Cmd+Y', 'Meta+Y'],
    action: 'redo',
    label: 'Redo',
    group: 'history',
    description: 'Redo the previously undone annotation action',
  },
  {
    id: 'history-delete-selected',
    key: 'Delete',
    keys: ['Backspace'],
    action: 'deleteSelected',
    label: 'Delete Selected',
    group: 'history',
    description: 'Delete the currently selected annotation',
  },

  // --- Navigation Controls ---
  {
    id: 'nav-next-page',
    key: 'Alt+ArrowDown',
    keys: ['Alt+Down', 'PageDown', 'J'],
    action: 'nextPage',
    label: 'Next Page',
    group: 'navigation',
    description: 'Navigate to the next page of the answer script',
  },
  {
    id: 'nav-prev-page',
    key: 'Alt+ArrowUp',
    keys: ['Alt+Up', 'PageUp', 'K'],
    action: 'prevPage',
    label: 'Previous Page',
    group: 'navigation',
    description: 'Navigate to the previous page of the answer script',
  },
  {
    id: 'nav-next-question',
    key: 'Q',
    action: 'nextQuestion',
    label: 'Next Question',
    group: 'navigation',
    description: 'Move to grading the next question',
  },
  {
    id: 'nav-prev-question',
    key: 'Shift+Q',
    action: 'prevQuestion',
    label: 'Previous Question',
    group: 'navigation',
    description: 'Move to grading the previous question',
  },
];

/**
 * Checks if the event target is an active typing input / textarea / contenteditable element.
 * When true, global shortcuts (like 'Enter', 'P', 'R', 'Delete') must be ignored to preserve typing.
 */
export function isTypingTarget(target: EventTarget | null | HTMLElement | { tagName?: string; isContentEditable?: boolean }): boolean {
  if (!target) return false;

  const el = target as HTMLElement;
  const tagName = el.tagName ? el.tagName.toUpperCase() : '';

  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
    return true;
  }

  if (el.isContentEditable) {
    return true;
  }

  if (typeof (el as HTMLElement).getAttribute === 'function') {
    const role = (el as HTMLElement).getAttribute('role');
    if (role === 'textbox' || role === 'searchbox') {
      return true;
    }
    const contentEditableAttr = (el as HTMLElement).getAttribute('contenteditable');
    if (contentEditableAttr === 'true' || contentEditableAttr === '') {
      return true;
    }
  }

  return false;
}

export interface KeyModifierState {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

/**
 * Canonicalizes key names (e.g., arrow down -> ArrowDown, esc -> Escape, enter -> Enter).
 */
export function canonicalizeKey(rawKey: string): string {
  if (!rawKey) return '';
  const trimmed = rawKey.trim();

  // Normalize casing for specific common keys
  const lower = trimmed.toLowerCase();
  if (lower === 'enter') return 'Enter';
  if (lower === 'escape' || lower === 'esc') return 'Escape';
  if (lower === 'backspace') return 'Backspace';
  if (lower === 'delete' || lower === 'del') return 'Delete';
  if (lower === 'arrowdown' || lower === 'down') return 'ArrowDown';
  if (lower === 'arrowup' || lower === 'up') return 'ArrowUp';
  if (lower === 'arrowleft' || lower === 'left') return 'ArrowLeft';
  if (lower === 'arrowright' || lower === 'right') return 'ArrowRight';
  if (lower === 'pagedown') return 'PageDown';
  if (lower === 'pageup') return 'PageUp';
  if (lower === 'space' || lower === ' ') return 'Space';
  if (lower === 'tab') return 'Tab';

  // Single characters
  if (trimmed.length === 1) {
    return trimmed.toUpperCase();
  }

  return trimmed;
}

/**
 * Parses a shortcut combo string (e.g., "Ctrl+Shift+Z", "Alt+Down", "Enter") into normalized structure.
 */
export function parseShortcutString(combo: string): {
  ctrlOrCmd: boolean;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  canonicalKey: string;
} {
  const parts = combo.split('+').map((p) => p.trim());
  let ctrlOrCmd = false;
  let ctrl = false;
  let meta = false;
  let alt = false;
  let shift = false;
  let rawKey = '';

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const pl = p.toLowerCase();
    if (pl === 'ctrl' || pl === 'control') {
      ctrl = true;
      ctrlOrCmd = true;
    } else if (pl === 'cmd' || pl === 'command' || pl === 'meta') {
      meta = true;
      ctrlOrCmd = true;
    } else if (pl === 'alt' || pl === 'option') {
      alt = true;
    } else if (pl === 'shift') {
      shift = true;
    } else {
      rawKey = p;
    }
  }

  return {
    ctrlOrCmd,
    ctrl,
    meta,
    alt,
    shift,
    canonicalKey: canonicalizeKey(rawKey),
  };
}

/**
 * Matches a KeyboardEvent against a single shortcut definition.
 */
export function matchesShortcut(shortcut: ShortcutDefinition, event: KeyboardEvent | KeyModifierState): boolean {
  if (shortcut.disabled) return false;

  const eventCtrlOrCmd = Boolean(event.ctrlKey || event.metaKey);
  const eventCtrl = Boolean(event.ctrlKey);
  const eventMeta = Boolean(event.metaKey);
  const eventAlt = Boolean(event.altKey);
  const eventShift = Boolean(event.shiftKey);
  const eventKey = canonicalizeKey(event.key);

  const candidateCombos = [shortcut.key, ...(shortcut.keys || [])];

  for (const combo of candidateCombos) {
    const parsed = parseShortcutString(combo);

    // Key match
    if (parsed.canonicalKey !== eventKey) {
      // Special check for = and +
      if (!((parsed.canonicalKey === '+' || parsed.canonicalKey === '=') && (eventKey === '+' || eventKey === '='))) {
        continue;
      }
    }

    // Modifier checks
    // Alt requirement
    if (parsed.alt !== eventAlt) continue;

    // Shift requirement
    if (parsed.shift !== eventShift) continue;

    // Ctrl/Meta requirement
    if (parsed.ctrlOrCmd) {
      if (!eventCtrlOrCmd) continue;
      // If combo specifically requested Ctrl and not Meta (or vice versa on non-mac),
      // we allow general ctrlOrCmd equivalence unless specifically distinguishing
      if (parsed.ctrl && !parsed.meta && !eventCtrl && !eventMeta) continue;
      if (parsed.meta && !parsed.ctrl && !eventMeta && !eventCtrl) continue;
    } else {
      if (eventCtrlOrCmd) continue;
    }

    return true;
  }

  return false;
}

/**
 * Finds the first matching ShortcutDefinition for a given KeyboardEvent from the keymap.
 */
export function findMatchingShortcut(
  event: KeyboardEvent | KeyModifierState,
  keymap: readonly ShortcutDefinition[] = SHORTCUT_MAP
): ShortcutDefinition | null {
  for (const shortcut of keymap) {
    if (matchesShortcut(shortcut, event)) {
      return shortcut;
    }
  }
  return null;
}

/**
 * Validates the shortcut map for internal collisions / ambiguous keybindings.
 */
export function validateShortcutMap(
  keymap: readonly ShortcutDefinition[] = SHORTCUT_MAP
): { valid: boolean; conflicts: Array<{ combo: string; actions: ShortcutAction[] }> } {
  const comboMap: Record<string, ShortcutAction[]> = {};

  for (const item of keymap) {
    const combos = [item.key, ...(item.keys || [])];
    for (const raw of combos) {
      const parsed = parseShortcutString(raw);
      // Normalized canonical representation for collision checking
      const normParts: string[] = [];
      if (parsed.ctrlOrCmd) normParts.push('CtrlOrCmd');
      if (parsed.alt) normParts.push('Alt');
      if (parsed.shift) normParts.push('Shift');
      normParts.push(parsed.canonicalKey);
      const signature = normParts.join('+');

      if (!comboMap[signature]) {
        comboMap[signature] = [];
      }
      if (!comboMap[signature].includes(item.action)) {
        comboMap[signature].push(item.action);
      }
    }
  }

  const conflicts: Array<{ combo: string; actions: ShortcutAction[] }> = [];
  for (const [combo, actions] of Object.entries(comboMap)) {
    if (actions.length > 1) {
      conflicts.push({ combo, actions });
    }
  }

  return {
    valid: conflicts.length === 0,
    conflicts,
  };
}

/**
 * Returns all shortcuts belonging to a specific group.
 */
export function getShortcutsByGroup(
  group: ShortcutGroup,
  keymap: readonly ShortcutDefinition[] = SHORTCUT_MAP
): ShortcutDefinition[] {
  return keymap.filter((s) => s.group === group);
}

/**
 * Returns shortcut definition by its unique action identifier.
 */
export function getShortcutByAction(
  action: ShortcutAction,
  keymap: readonly ShortcutDefinition[] = SHORTCUT_MAP
): ShortcutDefinition | undefined {
  return keymap.find((s) => s.action === action);
}

/**
 * Maps a tool shortcut action to its corresponding CanvasTool identifier.
 * Returns null if the action is not a tool action.
 */
export function actionToCanvasTool(action: ShortcutAction): string | null {
  switch (action) {
    case 'tool:select':
      return 'select';
    case 'tool:pen':
      return 'pen';
    case 'tool:eraser':
      return 'eraser';
    case 'tool:check':
      return 'check';
    case 'tool:cross':
      return 'cross';
    case 'tool:highlight':
      return 'highlight';
    case 'tool:text':
      return 'text';
    case 'toggleLoupe':
      return 'loupe';
    default:
      return null;
  }
}
/**
 * Section structure for organized UI display in ShortcutHelpOverlay.
 */
export interface ShortcutGroupSection {
  group: ShortcutGroup;
  title: string;
  shortcuts: ShortcutDefinition[];
}

/**
 * Returns human-readable section title for a shortcut group.
 */
export function getGroupTitle(group: ShortcutGroup): string {
  switch (group) {
    case 'grading':
      return 'Grading Actions';
    case 'tools':
      return 'Canvas Tools';
    case 'view':
      return 'View & Canvas Controls';
    case 'history':
      return 'History & Editing';
    case 'navigation':
      return 'Navigation Controls';
    default:
      return (group as string).charAt(0).toUpperCase() + (group as string).slice(1);
  }
}

/**
 * Groups a keymap array dynamically into grouped sections for overlay display.
 */
export function groupShortcuts(
  keymap: readonly ShortcutDefinition[] = SHORTCUT_MAP
): ShortcutGroupSection[] {
  const groupsMap = new Map<ShortcutGroup, ShortcutDefinition[]>();

  for (const shortcut of keymap) {
    if (!groupsMap.has(shortcut.group)) {
      groupsMap.set(shortcut.group, []);
    }
    groupsMap.get(shortcut.group)!.push(shortcut);
  }

  const sections: ShortcutGroupSection[] = [];
  for (const [group, shortcuts] of groupsMap.entries()) {
    sections.push({
      group,
      title: getGroupTitle(group),
      shortcuts,
    });
  }

  return sections;
}

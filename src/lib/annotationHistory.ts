/**
 * Annotation Action & History (Undo / Redo) Model (AE-128)
 *
 * Provides pure mathematical & data-structure utilities for:
 * - Immutable annotation actions (add-stroke, erase-strokes)
 * - Page-isolated past / future history stacks
 * - Performing undo / redo operations with stroke ordering, color, and width preservation
 */

import type { FreehandStroke } from './penTool';

export type AnnotationAction =
  | {
      type: 'add-stroke';
      stroke: FreehandStroke;
    }
  | {
      type: 'erase-strokes';
      strokes: FreehandStroke[];
      /** Indices where the strokes were located in the array prior to erasure */
      originalIndices: { id: string; index: number }[];
    };

export interface PageHistory {
  past: AnnotationAction[];
  future: AnnotationAction[];
}

/**
 * Creates an empty page history state.
 */
export function createInitialHistory(): PageHistory {
  return {
    past: [],
    future: [],
  };
}

/**
 * Checks if an undo operation is available.
 */
export function canUndo(history?: PageHistory | null): boolean {
  return Boolean(history && history.past.length > 0);
}

/**
 * Checks if a redo operation is available.
 */
export function canRedo(history?: PageHistory | null): boolean {
  return Boolean(history && history.future.length > 0);
}

/**
 * Pushes an 'add-stroke' action to history. Clears the redo (future) stack.
 */
export function recordAddStroke(
  history: PageHistory,
  stroke: FreehandStroke
): PageHistory {
  const action: AnnotationAction = {
    type: 'add-stroke',
    stroke,
  };

  return {
    past: [...history.past, action],
    future: [], // New action clears redo stack
  };
}

/**
 * Pushes an 'erase-strokes' action to history. Clears the redo (future) stack.
 */
export function recordEraseStrokes(
  history: PageHistory,
  erasedStrokes: FreehandStroke[],
  allPageStrokes: FreehandStroke[]
): PageHistory {
  if (!erasedStrokes || erasedStrokes.length === 0) {
    return history;
  }

  const erasedIds = new Set(erasedStrokes.map((s) => s.id));
  const originalIndices = allPageStrokes
    .map((s, index) => ({ id: s.id, index }))
    .filter((item) => erasedIds.has(item.id));

  const action: AnnotationAction = {
    type: 'erase-strokes',
    strokes: [...erasedStrokes],
    originalIndices,
  };

  return {
    past: [...history.past, action],
    future: [], // New action clears redo stack
  };
}

/**
 * Performs an undo operation.
 * Returns the updated history and the resulting page strokes.
 */
export function applyUndo(
  history: PageHistory,
  currentStrokes: FreehandStroke[]
): {
  history: PageHistory;
  strokes: FreehandStroke[];
} {
  if (!canUndo(history)) {
    return { history, strokes: currentStrokes };
  }

  const past = [...history.past];
  const lastAction = past.pop()!;
  const future = [lastAction, ...history.future];

  let nextStrokes = [...currentStrokes];

  if (lastAction.type === 'add-stroke') {
    // Undo adding a stroke -> remove that stroke
    nextStrokes = nextStrokes.filter((s) => s.id !== lastAction.stroke.id);
  } else if (lastAction.type === 'erase-strokes') {
    // Undo erasing strokes -> restore the erased strokes at their original positions
    const restoredMap = new Map(lastAction.strokes.map((s) => [s.id, s]));
    const indexMap = new Map(lastAction.originalIndices.map((item) => [item.id, item.index]));

    // Reconstruct the array with original ordering
    const reconstructed: (FreehandStroke | null)[] = [];
    const remainingStrokes = [...nextStrokes];

    // Build target positions
    const targetSize = remainingStrokes.length + lastAction.strokes.length;
    let remIdx = 0;

    for (let i = 0; i < targetSize; i++) {
      let inserted = false;
      for (const [id, originalIndex] of indexMap.entries()) {
        if (originalIndex === i && restoredMap.has(id)) {
          reconstructed.push(restoredMap.get(id)!);
          restoredMap.delete(id);
          inserted = true;
          break;
        }
      }

      if (!inserted && remIdx < remainingStrokes.length) {
        reconstructed.push(remainingStrokes[remIdx++]);
      }
    }

    // Append any leftover restored strokes if index mapping was sparse
    for (const stroke of restoredMap.values()) {
      reconstructed.push(stroke);
    }

    nextStrokes = reconstructed.filter((s): s is FreehandStroke => s !== null);
  }

  return {
    history: { past, future },
    strokes: nextStrokes,
  };
}

/**
 * Performs a redo operation.
 * Returns the updated history and the resulting page strokes.
 */
export function applyRedo(
  history: PageHistory,
  currentStrokes: FreehandStroke[]
): {
  history: PageHistory;
  strokes: FreehandStroke[];
} {
  if (!canRedo(history)) {
    return { history, strokes: currentStrokes };
  }

  const future = [...history.future];
  const nextAction = future.shift()!;
  const past = [...history.past, nextAction];

  let nextStrokes = [...currentStrokes];

  if (nextAction.type === 'add-stroke') {
    // Redo adding a stroke -> re-append the stroke
    const exists = nextStrokes.some((s) => s.id === nextAction.stroke.id);
    if (!exists) {
      nextStrokes.push(nextAction.stroke);
    }
  } else if (nextAction.type === 'erase-strokes') {
    // Redo erasing strokes -> remove the erased strokes
    const erasedIds = new Set(nextAction.strokes.map((s) => s.id));
    nextStrokes = nextStrokes.filter((s) => !erasedIds.has(s.id));
  }

  return {
    history: { past, future },
    strokes: nextStrokes,
  };
}

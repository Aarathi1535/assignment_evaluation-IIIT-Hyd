/**
 * Annotation Action & History (Undo / Redo) Model (AE-128)
 *
 * Provides pure mathematical & data-structure utilities for:
 * - Immutable annotation actions (add-stroke, erase-strokes)
 * - Page-isolated past / future history stacks
 * - Performing undo / redo operations with stroke ordering, color, and width preservation
 */

import type { FreehandStroke } from './penTool';
import type { MarkAnnotation } from './stampTool';

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
    }
  | {
      type: 'add-annotation';
      annotation: MarkAnnotation;
    }
  | {
      type: 'erase-annotations';
      annotations: MarkAnnotation[];
      /** Indices where the annotations were located in the array prior to erasure */
      originalIndices: { id: string; index: number }[];
    }
  | {
      type: 'move-annotation';
      annotationId: string;
      previousPosition: { x: number; y: number };
      newPosition: { x: number; y: number };
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
 * Pushes an 'add-annotation' action (check, cross, highlight) to history. Clears the redo stack.
 */
export function recordAddAnnotation(
  history: PageHistory,
  annotation: MarkAnnotation
): PageHistory {
  const action: AnnotationAction = {
    type: 'add-annotation',
    annotation,
  };

  return {
    past: [...history.past, action],
    future: [], // New action clears redo stack
  };
}

/**
 * Pushes an 'erase-annotations' action to history. Clears the redo stack.
 */
export function recordEraseAnnotations(
  history: PageHistory,
  erasedAnnotations: MarkAnnotation[],
  allPageAnnotations: MarkAnnotation[]
): PageHistory {
  if (!erasedAnnotations || erasedAnnotations.length === 0) {
    return history;
  }

  const erasedIds = new Set(erasedAnnotations.map((a) => a.id));
  const originalIndices = allPageAnnotations
    .map((a, index) => ({ id: a.id, index }))
    .filter((item) => erasedIds.has(item.id));

  const action: AnnotationAction = {
    type: 'erase-annotations',
    annotations: [...erasedAnnotations],
    originalIndices,
  };

  return {
    past: [...history.past, action],
    future: [], // New action clears redo stack
  };
}

/**
 * Pushes a 'move-annotation' action to history. Clears the redo stack.
 */
export function recordMoveAnnotation(
  history: PageHistory,
  annotationId: string,
  previousPosition: { x: number; y: number },
  newPosition: { x: number; y: number }
): PageHistory {
  if (
    previousPosition.x === newPosition.x &&
    previousPosition.y === newPosition.y
  ) {
    return history;
  }

  const action: AnnotationAction = {
    type: 'move-annotation',
    annotationId,
    previousPosition,
    newPosition,
  };

  return {
    past: [...history.past, action],
    future: [], // New action clears redo stack
  };
}

/**
 * Performs an undo operation.
 * Returns the updated history and the resulting page strokes and annotations.
 */
export function applyUndo(
  history: PageHistory,
  currentStrokes: FreehandStroke[] = [],
  currentAnnotations: MarkAnnotation[] = []
): {
  history: PageHistory;
  strokes: FreehandStroke[];
  annotations: MarkAnnotation[];
} {
  if (!canUndo(history)) {
    return { history, strokes: currentStrokes, annotations: currentAnnotations };
  }

  const past = [...history.past];
  const lastAction = past.pop()!;
  const future = [lastAction, ...history.future];

  let nextStrokes = [...currentStrokes];
  let nextAnnotations = [...currentAnnotations];

  if (lastAction.type === 'add-stroke') {
    // Undo adding a stroke -> remove that stroke
    nextStrokes = nextStrokes.filter((s) => s.id !== lastAction.stroke.id);
  } else if (lastAction.type === 'erase-strokes') {
    // Undo erasing strokes -> restore the erased strokes at their original positions
    const restoredMap = new Map(lastAction.strokes.map((s) => [s.id, s]));
    const indexMap = new Map(lastAction.originalIndices.map((item) => [item.id, item.index]));

    const reconstructed: (FreehandStroke | null)[] = [];
    const remainingStrokes = [...nextStrokes];

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

    for (const stroke of restoredMap.values()) {
      reconstructed.push(stroke);
    }

    nextStrokes = reconstructed.filter((s): s is FreehandStroke => s !== null);
  } else if (lastAction.type === 'add-annotation') {
    // Undo adding an annotation -> remove that annotation
    nextAnnotations = nextAnnotations.filter((a) => a.id !== lastAction.annotation.id);
  } else if (lastAction.type === 'erase-annotations') {
    // Undo erasing annotations -> restore the erased annotations at their original positions
    const restoredMap = new Map(lastAction.annotations.map((a) => [a.id, a]));
    const indexMap = new Map(lastAction.originalIndices.map((item) => [item.id, item.index]));

    const reconstructed: (MarkAnnotation | null)[] = [];
    const remainingAnnotations = [...nextAnnotations];

    const targetSize = remainingAnnotations.length + lastAction.annotations.length;
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

      if (!inserted && remIdx < remainingAnnotations.length) {
        reconstructed.push(remainingAnnotations[remIdx++]);
      }
    }

    for (const ann of restoredMap.values()) {
      reconstructed.push(ann);
    }

    nextAnnotations = reconstructed.filter((a): a is MarkAnnotation => a !== null);
  } else if (lastAction.type === 'move-annotation') {
    // Undo moving an annotation -> restore previous position
    nextAnnotations = nextAnnotations.map((a) =>
      a.id === lastAction.annotationId
        ? ({ ...a, x: lastAction.previousPosition.x, y: lastAction.previousPosition.y } as MarkAnnotation)
        : a
    );
  }

  return {
    history: { past, future },
    strokes: nextStrokes,
    annotations: nextAnnotations,
  };
}

/**
 * Performs a redo operation.
 * Returns the updated history and the resulting page strokes and annotations.
 */
export function applyRedo(
  history: PageHistory,
  currentStrokes: FreehandStroke[] = [],
  currentAnnotations: MarkAnnotation[] = []
): {
  history: PageHistory;
  strokes: FreehandStroke[];
  annotations: MarkAnnotation[];
} {
  if (!canRedo(history)) {
    return { history, strokes: currentStrokes, annotations: currentAnnotations };
  }

  const future = [...history.future];
  const nextAction = future.shift()!;
  const past = [...history.past, nextAction];

  let nextStrokes = [...currentStrokes];
  let nextAnnotations = [...currentAnnotations];

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
  } else if (nextAction.type === 'add-annotation') {
    // Redo adding an annotation -> re-append the annotation
    const exists = nextAnnotations.some((a) => a.id === nextAction.annotation.id);
    if (!exists) {
      nextAnnotations.push(nextAction.annotation);
    }
  } else if (nextAction.type === 'erase-annotations') {
    // Redo erasing annotations -> remove the erased annotations
    const erasedIds = new Set(nextAction.annotations.map((a) => a.id));
    nextAnnotations = nextAnnotations.filter((a) => !erasedIds.has(a.id));
  } else if (nextAction.type === 'move-annotation') {
    // Redo moving an annotation -> apply new position
    nextAnnotations = nextAnnotations.map((a) =>
      a.id === nextAction.annotationId
        ? ({ ...a, x: nextAction.newPosition.x, y: nextAction.newPosition.y } as MarkAnnotation)
        : a
    );
  }

  return {
    history: { past, future },
    strokes: nextStrokes,
    annotations: nextAnnotations,
  };
}

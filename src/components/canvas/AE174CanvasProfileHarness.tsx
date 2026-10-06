'use client';

import { useCallback, useMemo, useState } from 'react';
import { AnswerSheetCanvas, SAMPLE_ANSWER_SHEET_DATA_URI } from './AnswerSheetCanvas';
import type { FreehandStroke } from '@/lib/penTool';
import type { AnswerSheetPage } from '@/lib/pageNavigation';

function makeStrokes(count: number): FreehandStroke[] {
  return Array.from({ length: count }, (_, strokeIndex) => ({
    id: `ae174-seed-${strokeIndex}`,
    pageKey: 'ae174-page-1',
    points: Array.from({ length: 24 }, (_, pointIndex) => {
      const point = Math.floor(pointIndex / 2);
      const offset = (strokeIndex * 29 + point * 17) % 620;
      return pointIndex % 2 === 0 ? 90 + offset : 160 + ((strokeIndex * 13 + point * 11) % 820);
    }),
    color: '#1d4ed8',
    strokeWidth: 2,
    createdAt: strokeIndex,
  }));
}

export default function AE174CanvasProfileHarness() {
  const [strokeCount, setStrokeCount] = useState(0);
  const [strokes, setStrokes] = useState<FreehandStroke[]>([]);
  const seededStrokes = useMemo(() => makeStrokes(strokeCount), [strokeCount]);
  const visibleStrokes = strokeCount === 0 ? strokes : seededStrokes;
  const pages = useMemo<AnswerSheetPage[]>(() => [
    { _id: 'ae174-page-1', pageNumber: 1, src: SAMPLE_ANSWER_SHEET_DATA_URI },
    { _id: 'ae174-page-2', pageNumber: 2, src: SAMPLE_ANSWER_SHEET_DATA_URI },
  ], []);
  const saveAnnotations = useCallback(async () => ({ success: true }), []);

  const setZoom = async (zoom: 1 | 4) => {
    const resetButton = document.querySelector<HTMLButtonElement>('[data-testid="canvas-zoom-readout"]');
    resetButton?.click();
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    if (zoom === 4) {
      for (let click = 0; click < 16; click += 1) {
        document.querySelector<HTMLButtonElement>('[data-testid="canvas-zoom-in-button"]')?.click();
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
      }
    }
  };

  return (
    <main className="min-h-screen bg-slate-100 p-4">
      <header className="mb-3 flex flex-wrap items-center gap-2 rounded bg-white p-3 text-sm">
        <strong>AE-174 browser profile</strong>
        {[0, 50, 200].map((count) => (
          <button
            key={count}
            type="button"
            data-testid={`ae174-strokes-${count}`}
            className="rounded border px-3 py-1"
            onClick={() => {
              setStrokeCount(count);
              setStrokes([]);
            }}
          >
            {count} strokes
          </button>
        ))}
        <button type="button" data-testid="ae174-zoom-1x" className="rounded border px-3 py-1" onClick={() => void setZoom(1)}>
          1x
        </button>
        <button type="button" data-testid="ae174-zoom-4x" className="rounded border px-3 py-1" onClick={() => void setZoom(4)}>
          4x
        </button>
        <span data-testid="ae174-scenario" className="ml-auto">{strokeCount} strokes</span>
      </header>
      <section className="mx-auto h-[calc(100vh-100px)] max-w-6xl">
        <AnswerSheetCanvas
          pages={pages}
          width="auto"
          height={760}
          className="h-full"
          initialPenActive
          initialLoading={false}
          enableAnnotationLoading={false}
          enableAutosave
          enableCrashRecovery={false}
          enableShortcutHelp={false}
          scriptId="ae174-profile"
          userId="ae174-profile"
          saveAnnotations={saveAnnotations}
          strokes={visibleStrokes}
          onStrokesChange={setStrokes}
        />
      </section>
    </main>
  );
}

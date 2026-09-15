import { describe, it, expect } from 'vitest';
import {
  PEN_COLORS,
  PEN_WIDTHS,
  DEFAULT_PEN_COLOR_ID,
  DEFAULT_PEN_WIDTH_ID,
  DEFAULT_PEN_COLOR,
  resolvePenColor,
  resolvePenWidth,
  calculatePressureStrokeWidth,
  createStroke,
  filterStrokesByPage,
  FreehandStroke,
  PenColorId,
  PenWidthId,
  MIN_PRESSURE_WIDTH_MULTIPLIER,
  MAX_PRESSURE_WIDTH_MULTIPLIER,
} from '../lib/penTool';

describe('AE-127: Pen Color & Stroke-Width Selector', () => {
  describe('1. Supported Color Palette & Defaults', () => {
    it('supports exactly red, blue, and green colors with distinct hex values', () => {
      expect(Object.keys(PEN_COLORS)).toEqual(['red', 'blue', 'green']);
      expect(PEN_COLORS.red.value).toBe('#e11d48');
      expect(PEN_COLORS.blue.value).toBe('#2563eb');
      expect(PEN_COLORS.green.value).toBe('#16a34a');
    });

    it('has red as the default selected color', () => {
      expect(DEFAULT_PEN_COLOR_ID).toBe('red');
      expect(resolvePenColor()).toBe(PEN_COLORS.red.value);
    });

    it('resolves color IDs to exact hex values', () => {
      expect(resolvePenColor('red')).toBe('#e11d48');
      expect(resolvePenColor('blue')).toBe('#2563eb');
      expect(resolvePenColor('green')).toBe('#16a34a');
    });

    it('handles direct hex color or invalid string with graceful fallback', () => {
      expect(resolvePenColor('#ff0000')).toBe('#ff0000');
      expect(resolvePenColor('')).toBe(DEFAULT_PEN_COLOR);
      expect(resolvePenColor(undefined)).toBe(DEFAULT_PEN_COLOR);
    });
  });

  describe('2. Supported Stroke Widths & Defaults', () => {
    it('supports exactly thin (2px) and thick (5px) stroke widths', () => {
      expect(Object.keys(PEN_WIDTHS)).toEqual(['thin', 'thick']);
      expect(PEN_WIDTHS.thin.value).toBe(2);
      expect(PEN_WIDTHS.thick.value).toBe(5);
    });

    it('has thin as the default selected stroke width', () => {
      expect(DEFAULT_PEN_WIDTH_ID).toBe('thin');
      expect(resolvePenWidth()).toBe(PEN_WIDTHS.thin.value);
    });

    it('resolves width IDs to concrete numeric pixel values', () => {
      expect(resolvePenWidth('thin')).toBe(2);
      expect(resolvePenWidth('thick')).toBe(5);
    });

    it('handles custom numeric widths or invalid inputs with graceful fallback', () => {
      expect(resolvePenWidth(4)).toBe(4);
      expect(resolvePenWidth(0)).toBe(PEN_WIDTHS.thin.value);
      expect(resolvePenWidth(-2)).toBe(PEN_WIDTHS.thin.value);
      expect(resolvePenWidth(NaN)).toBe(PEN_WIDTHS.thin.value);
      expect(resolvePenWidth(undefined)).toBe(PEN_WIDTHS.thin.value);
    });
  });

  describe('3. Flow of Selected Style to Newly Created Strokes', () => {
    it('creates new strokes with the selected red color and thin stroke width', () => {
      const color = resolvePenColor('red');
      const width = resolvePenWidth('thin');
      const stroke = createStroke('page-1', { x: 10, y: 20 }, { color, strokeWidth: width });

      expect(stroke.color).toBe('#e11d48');
      expect(stroke.strokeWidth).toBe(2);
      expect(stroke.pageKey).toBe('page-1');
    });

    it('creates new strokes with the selected blue color and thick stroke width', () => {
      const color = resolvePenColor('blue');
      const width = resolvePenWidth('thick');
      const stroke = createStroke('page-1', { x: 50, y: 60 }, { color, strokeWidth: width });

      expect(stroke.color).toBe('#2563eb');
      expect(stroke.strokeWidth).toBe(5);
    });

    it('creates new strokes with the selected green color', () => {
      const color = resolvePenColor('green');
      const width = resolvePenWidth('thin');
      const stroke = createStroke('page-1', { x: 100, y: 150 }, { color, strokeWidth: width });

      expect(stroke.color).toBe('#16a34a');
      expect(stroke.strokeWidth).toBe(2);
    });
  });

  describe('4. Style Immutability: Existing Strokes Retain Their Original Style', () => {
    it('does not alter existing strokes when the active color or width is changed', () => {
      // 1. Draw initial stroke with Red Thin
      const stroke1 = createStroke(
        'page-1',
        { x: 10, y: 10 },
        { color: resolvePenColor('red'), strokeWidth: resolvePenWidth('thin') }
      );
      const strokesList: FreehandStroke[] = [stroke1];

      // 2. TA switches tool to Blue Thick
      let activeColor: PenColorId = 'blue';
      let activeWidth: PenWidthId = 'thick';

      // 3. Draw second stroke with Blue Thick
      const stroke2 = createStroke(
        'page-1',
        { x: 50, y: 50 },
        { color: resolvePenColor(activeColor), strokeWidth: resolvePenWidth(activeWidth) }
      );
      const updatedStrokes = [...strokesList, stroke2];

      // 4. TA switches tool to Green Thin
      activeColor = 'green';
      activeWidth = 'thin';

      // Verify stroke1 is completely unchanged
      expect(updatedStrokes[0].id).toBe(stroke1.id);
      expect(updatedStrokes[0].color).toBe('#e11d48'); // Still Red
      expect(updatedStrokes[0].strokeWidth).toBe(2); // Still Thin (2px)

      // Verify stroke2 is completely unchanged
      expect(updatedStrokes[1].id).toBe(stroke2.id);
      expect(updatedStrokes[1].color).toBe('#2563eb'); // Still Blue
      expect(updatedStrokes[1].strokeWidth).toBe(5); // Still Thick (5px)

      // 5. Draw third stroke with Green Thin
      const stroke3 = createStroke(
        'page-1',
        { x: 100, y: 100 },
        { color: resolvePenColor(activeColor), strokeWidth: resolvePenWidth(activeWidth) }
      );
      const finalStrokes = [...updatedStrokes, stroke3];

      expect(finalStrokes[2].color).toBe('#16a34a'); // Green
      expect(finalStrokes[2].strokeWidth).toBe(2); // Thin
    });
  });

  describe('5. Pressure Compatibility with Selected Base Widths', () => {
    it('scales pressure conservatively when base width is thin (2px)', () => {
      const baseWidth = resolvePenWidth('thin'); // 2px

      // Without pressure -> 2px
      expect(calculatePressureStrokeWidth(baseWidth, undefined)).toBe(2);

      // Minimum pressure -> 2 * 0.5 = 1.0px
      const minP = calculatePressureStrokeWidth(baseWidth, 0.01);
      expect(minP).toBeGreaterThanOrEqual(baseWidth * MIN_PRESSURE_WIDTH_MULTIPLIER);

      // Maximum pressure -> 2 * 1.75 = 3.5px
      const maxP = calculatePressureStrokeWidth(baseWidth, 1.0);
      expect(maxP).toBe(2 * MAX_PRESSURE_WIDTH_MULTIPLIER); // 3.5
    });

    it('scales pressure conservatively when base width is thick (5px)', () => {
      const baseWidth = resolvePenWidth('thick'); // 5px

      // Without pressure -> 5px
      expect(calculatePressureStrokeWidth(baseWidth, undefined)).toBe(5);

      // Minimum pressure -> 5 * 0.5 = 2.5px
      const minP = calculatePressureStrokeWidth(baseWidth, 0.01);
      expect(minP).toBeGreaterThanOrEqual(baseWidth * MIN_PRESSURE_WIDTH_MULTIPLIER);

      // Maximum pressure -> 5 * 1.75 = 8.75px
      const maxP = calculatePressureStrokeWidth(baseWidth, 1.0);
      expect(maxP).toBe(5 * MAX_PRESSURE_WIDTH_MULTIPLIER); // 8.75
    });

    it('creates pressure-sensitive strokes using selected base width', () => {
      const strokeThinPressure = createStroke(
        'page-1',
        { x: 10, y: 10 },
        {
          color: resolvePenColor('blue'),
          strokeWidth: resolvePenWidth('thin'),
          pressure: 1.0,
        }
      );
      expect(strokeThinPressure.color).toBe('#2563eb');
      expect(strokeThinPressure.strokeWidth).toBe(3.5); // 2 * 1.75

      const strokeThickPressure = createStroke(
        'page-1',
        { x: 20, y: 20 },
        {
          color: resolvePenColor('green'),
          strokeWidth: resolvePenWidth('thick'),
          pressure: 1.0,
        }
      );
      expect(strokeThickPressure.color).toBe('#16a34a');
      expect(strokeThickPressure.strokeWidth).toBe(8.75); // 5 * 1.75
    });
  });

  describe('6. Multi-Page Style Consistency & Isolation', () => {
    it('persists selected style across page navigation while isolating stroke state', () => {
      let activeColor: PenColorId = 'red';
      let activeWidth: PenWidthId = 'thin';
      let sessionStrokes: FreehandStroke[] = [];

      // 1. On Page 1 with Red Thin
      const page1Stroke = createStroke(
        'page-1',
        { x: 15, y: 25 },
        { color: resolvePenColor(activeColor), strokeWidth: resolvePenWidth(activeWidth) }
      );
      sessionStrokes = [...sessionStrokes, page1Stroke];

      // 2. TA changes style to Green Thick while on Page 1
      activeColor = 'green';
      activeWidth = 'thick';

      // 3. TA navigates to Page 2 (style persists, but strokes are isolated)
      expect(filterStrokesByPage(sessionStrokes, 'page-2')).toEqual([]);

      // 4. On Page 2, draw stroke with persisted Green Thick style
      const page2Stroke = createStroke(
        'page-2',
        { x: 80, y: 90 },
        { color: resolvePenColor(activeColor), strokeWidth: resolvePenWidth(activeWidth) }
      );
      sessionStrokes = [...sessionStrokes, page2Stroke];

      // Verify Page 2 stroke has Green Thick
      const page2Strokes = filterStrokesByPage(sessionStrokes, 'page-2');
      expect(page2Strokes.length).toBe(1);
      expect(page2Strokes[0].color).toBe('#16a34a');
      expect(page2Strokes[0].strokeWidth).toBe(5);

      // 5. TA returns to Page 1
      const restoredPage1Strokes = filterStrokesByPage(sessionStrokes, 'page-1');
      expect(restoredPage1Strokes.length).toBe(1);
      expect(restoredPage1Strokes[0].color).toBe('#e11d48'); // Original Red Thin
      expect(restoredPage1Strokes[0].strokeWidth).toBe(2);
    });
  });

  describe('7. Option Metadata & Accessibility Labels', () => {
    it('provides accessible labels and human-readable names for all color options', () => {
      expect(PEN_COLORS.red.label).toBe('Red');
      expect(PEN_COLORS.blue.label).toBe('Blue');
      expect(PEN_COLORS.green.label).toBe('Green');
    });

    it('provides accessible labels and pixel values for all width options', () => {
      expect(PEN_WIDTHS.thin.label).toBe('Thin');
      expect(PEN_WIDTHS.thin.value).toBe(2);
      expect(PEN_WIDTHS.thick.label).toBe('Thick');
      expect(PEN_WIDTHS.thick.value).toBe(5);
    });
  });
});

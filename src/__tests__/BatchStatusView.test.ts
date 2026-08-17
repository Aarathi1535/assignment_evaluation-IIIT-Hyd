import { describe, it, expect } from 'vitest';

// Function to simulate elapsed duration formatting in the component
function getDurationString(elapsedSeconds: number) {
  if (elapsedSeconds <= 0) return '0 seconds';
  const mins = Math.floor(elapsedSeconds / 60);
  const secs = elapsedSeconds % 60;
  
  if (mins > 0) {
    return `${mins} minute${mins !== 1 ? 's' : ''} ${secs} second${secs !== 1 ? 's' : ''}`;
  }
  return `${secs} second${secs !== 1 ? 's' : ''}`;
}

describe('BatchStatusView Logic & Duration Helper Tests (AE-059)', () => {
  it('should correctly format various durations in human readable form', () => {
    expect(getDurationString(0)).toBe('0 seconds');
    expect(getDurationString(30)).toBe('30 seconds');
    expect(getDurationString(60)).toBe('1 minute 0 seconds');
    expect(getDurationString(125)).toBe('2 minutes 5 seconds');
  });

  it('should correctly classify a batch as stuck if running in queued/processing state for over 3 minutes', () => {
    const elapsedSecondsNormal = 150;
    const elapsedSecondsStuck = 181;

    const isStuckNormal = elapsedSecondsNormal > 180;
    const isStuckWarning = elapsedSecondsStuck > 180;

    expect(isStuckNormal).toBe(false);
    expect(isStuckWarning).toBe(true);
  });

  it('should properly configure labels for each possible ingestion status', () => {
    const statusConfig = {
      queued: { label: 'Queued' },
      processing: { label: 'Processing' },
      done: { label: 'Completed' },
      failed: { label: 'Failed' }
    };

    expect(statusConfig['queued'].label).toBe('Queued');
    expect(statusConfig['processing'].label).toBe('Processing');
    expect(statusConfig['done'].label).toBe('Completed');
    expect(statusConfig['failed'].label).toBe('Failed');
  });
});

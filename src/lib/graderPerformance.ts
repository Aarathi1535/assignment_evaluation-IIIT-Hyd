export function logGraderTiming(
  stage: string,
  startedAt: number,
  details: Record<string, string | number | boolean> = {}
): void {
  if (
    process.env.GRADER_PERF_LOGS !== 'true' &&
    process.env.NEXT_PUBLIC_GRADER_PERF_LOGS !== 'true'
  ) {
    return;
  }

  console.info('[grader-perf]', {
    stage,
    elapsedMs: Math.round(performance.now() - startedAt),
    ...details,
  });
}

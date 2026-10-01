export function resolveTargetExamId(
  allocations: Array<{ exam: string }>,
  selectedExamId?: string | null
): string | null {
  if (selectedExamId && selectedExamId !== 'ALL') {
    return selectedExamId;
  }
  const uniqueExams = Array.from(new Set(allocations.map((a) => a.exam).filter(Boolean)));
  if (uniqueExams.length === 1) {
    return uniqueExams[0];
  }
  return null;
}

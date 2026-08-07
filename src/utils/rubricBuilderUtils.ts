export interface Criterion {
  criterionName: string;
  description?: string;
  points: number;
}

export interface Question {
  questionNumber: number;
  maxMarks: number;
  criteria: Criterion[];
}

export function validateRubricClient(questions: Question[]): string[] {
  const errors: string[] = [];

  if (!questions || questions.length === 0) {
    errors.push('At least one question is required.');
    return errors;
  }

  const questionNumbers = questions.map(q => Number(q.questionNumber));
  const uniqueNumbers = new Set(questionNumbers);
  if (uniqueNumbers.size !== questionNumbers.length) {
    errors.push('Duplicate question numbers are not allowed.');
  }

  questions.forEach((q, qIdx) => {
    const qNum = q.questionNumber;
    if (!qNum || isNaN(qNum) || qNum <= 0) {
      errors.push(`Question #${qIdx + 1}: Question number must be a positive integer.`);
    }

    const qMax = Number(q.maxMarks);
    if (isNaN(qMax) || qMax <= 0) {
      errors.push(`Question #${qNum || qIdx + 1}: Max marks must be a positive number.`);
    }

    if (!q.criteria || q.criteria.length === 0) {
      errors.push(`Question #${qNum || qIdx + 1}: At least one criterion is required.`);
    } else {
      let pointsSum = 0;
      q.criteria.forEach((c, cIdx) => {
        if (!c.criterionName || !c.criterionName.trim()) {
          errors.push(`Question #${qNum || qIdx + 1}, Criterion #${cIdx + 1}: Name is required.`);
        }
        const pts = Number(c.points);
        if (isNaN(pts) || pts <= 0) {
          errors.push(`Question #${qNum || qIdx + 1}, Criterion #${cIdx + 1}: Points must be a positive number.`);
        } else {
          pointsSum += pts;
        }
      });

      if (qMax && pointsSum > qMax) {
        errors.push(`Question #${qNum || qIdx + 1}: Sum of criteria points (${pointsSum}) cannot exceed maximum marks (${qMax}).`);
      }
    }
  });

  return errors;
}

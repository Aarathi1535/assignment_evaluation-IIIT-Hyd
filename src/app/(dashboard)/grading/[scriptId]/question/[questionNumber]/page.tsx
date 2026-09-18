'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { GradingWorkspace } from '@/components/grading/GradingWorkspace';

export default function QuestionGradingPage() {
  const params = useParams();
  const scriptId = (params?.scriptId as string) || '';
  const questionNumberParam = params?.questionNumber as string;
  const questionNumber = questionNumberParam ? parseInt(questionNumberParam, 10) : undefined;

  return (
    <GradingWorkspace
      scriptId={scriptId}
      allocatedQuestionNumber={Number.isNaN(questionNumber) ? undefined : questionNumber}
    />
  );
}


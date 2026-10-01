'use client';

import React from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { GradingWorkspace } from '@/components/grading/GradingWorkspace';

export default function QuestionGradingPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const scriptId = (params?.scriptId as string) || '';
  const questionNumberParam = params?.questionNumber as string;
  const questionNumber = questionNumberParam ? parseInt(questionNumberParam, 10) : undefined;
  const allocationId = searchParams?.get('allocationId') || undefined;

  return (
    <GradingWorkspace
      scriptId={scriptId}
      allocationId={allocationId}
      allocatedQuestionNumber={Number.isNaN(questionNumber) ? undefined : questionNumber}
    />
  );
}


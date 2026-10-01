'use client';

import React from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { GradingWorkspace } from '@/components/grading/GradingWorkspace';

export default function GradingPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const scriptId = (params?.scriptId as string) || '';
  const flagId = searchParams?.get('flagId') || undefined;
  const reviewModeParam = searchParams?.get('reviewMode');
  const isReviewMode = reviewModeParam === 'true' || Boolean(flagId);
  const questionParam = searchParams?.get('question');
  const questionNumber = questionParam ? parseInt(questionParam, 10) : undefined;
  const allocationId = searchParams?.get('allocationId') || undefined;
  return (
    <GradingWorkspace
      scriptId={scriptId}
      allocationId={allocationId}
      flagId={flagId}
      isReviewMode={isReviewMode}
      allocatedQuestionNumber={questionNumber}
    />
  );
}



'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { GradingWorkspace } from '@/components/grading/GradingWorkspace';

export default function GradingPage() {
  const params = useParams();
  const scriptId = (params?.scriptId as string) || '';

  return <GradingWorkspace scriptId={scriptId} />;
}


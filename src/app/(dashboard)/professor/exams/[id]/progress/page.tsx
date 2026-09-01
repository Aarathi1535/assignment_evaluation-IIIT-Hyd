import React from 'react';
import { DashboardLayout } from '@/components/ui/DashboardLayout';
import TaLiveProgressView from '@/components/TaLiveProgressView';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ProfessorExamProgressPage({ params }: PageProps) {
  const { id } = await params;

  return (
    <DashboardLayout
      title="Per-TA Live Progress"
      description="Live grading progress monitoring per Teaching Assistant."
    >
      <TaLiveProgressView examId={id} />
    </DashboardLayout>
  );
}

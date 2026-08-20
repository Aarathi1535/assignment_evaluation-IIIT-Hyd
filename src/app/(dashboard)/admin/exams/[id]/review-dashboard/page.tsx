import React from 'react';
import { DashboardLayout } from '@/components/ui/DashboardLayout';
import ReviewDashboardView from '@/components/ReviewDashboardView';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminReviewDashboardPage({ params }: PageProps) {
  const { id } = await params;

  return (
    <DashboardLayout
      title="Ingestion Review Dashboard (Admin)"
      description="Aggregated review counts and status summary of processed answer scripts."
    >
      <ReviewDashboardView examId={id} role="ADMIN" />
    </DashboardLayout>
  );
}

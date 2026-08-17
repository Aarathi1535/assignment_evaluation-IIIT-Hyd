import React from 'react';
import { DashboardLayout } from '@/components/ui/DashboardLayout';
import BatchStatusView from '@/components/BatchStatusView';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ProfessorBatchStatusPage({ params }: PageProps) {
  const { id } = await params;

  return (
    <DashboardLayout
      title="Ingestion Status"
      description="Monitor real-time progress of answer script splitting and QR mapping."
    >
      <BatchStatusView batchId={id} role="PROFESSOR" />
    </DashboardLayout>
  );
}

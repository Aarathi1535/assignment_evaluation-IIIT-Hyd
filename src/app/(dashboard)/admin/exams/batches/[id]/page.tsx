import React from 'react';
import { DashboardLayout } from '@/components/ui/DashboardLayout';
import BatchStatusView from '@/components/BatchStatusView';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminBatchStatusPage({ params }: PageProps) {
  const { id } = await params;

  return (
    <DashboardLayout
      title="Ingestion Status (Admin)"
      description="Monitor real-time progress of answer script splitting and QR mapping as an Administrator."
    >
      <BatchStatusView batchId={id} role="ADMIN" />
    </DashboardLayout>
  );
}

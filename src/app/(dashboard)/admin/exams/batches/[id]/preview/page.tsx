import React from 'react';
import { DashboardLayout } from '@/components/ui/DashboardLayout';
import BatchPreviewView from '@/components/BatchPreviewView';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminBatchPreviewPage({ params }: PageProps) {
  const { id } = await params;

  return (
    <DashboardLayout
      title="Batch Scripts Preview (Admin)"
      description="Inspect processed student answer scripts and verified student identities as an Administrator."
    >
      <BatchPreviewView batchId={id} role="ADMIN" />
    </DashboardLayout>
  );
}

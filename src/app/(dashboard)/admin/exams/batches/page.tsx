import React from 'react';
import { DashboardLayout } from '@/components/ui/DashboardLayout';
import BatchListView from '@/components/BatchListView';

export default function AdminBatchListPage() {
  return (
    <DashboardLayout
      title="Ingestion Batches (Admin)"
      description="Monitor and manage all system ingestion batches and student identification overrides."
    >
      <BatchListView role="ADMIN" />
    </DashboardLayout>
  );
}

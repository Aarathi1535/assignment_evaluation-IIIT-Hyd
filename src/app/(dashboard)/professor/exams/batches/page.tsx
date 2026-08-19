import React from 'react';
import { DashboardLayout } from '@/components/ui/DashboardLayout';
import BatchListView from '@/components/BatchListView';

export default function ProfessorBatchListPage() {
  return (
    <DashboardLayout
      title="Ingestion Batches"
      description="Monitor and manage real-time progress of answer script splitting and student identification."
    >
      <BatchListView role="PROFESSOR" />
    </DashboardLayout>
  );
}

import React from 'react';
import { DashboardLayout } from '@/components/ui/DashboardLayout';
import AllocationView from '@/components/AllocationView';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ProfessorAllocationPage({ params }: PageProps) {
  const { id } = await params;

  return (
    <DashboardLayout
      title="Professor Allocation"
      description="Configure and preview script allocation rules across teaching assistants."
    >
      <AllocationView examId={id} />
    </DashboardLayout>
  );
}

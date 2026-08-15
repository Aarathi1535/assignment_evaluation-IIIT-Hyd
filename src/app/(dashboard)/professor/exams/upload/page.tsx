'use client';

import React from 'react';
import { DashboardLayout } from '@/components/ui/DashboardLayout';
import UploadUI from '@/components/UploadUI';

export default function ProfessorUploadPage() {
  return (
    <DashboardLayout
      title="Upload Answer Sheets"
      description="Ingest scan packages, PDF booklets, or high-resolution images to match templates and grade submissions."
    >
      <UploadUI role="PROFESSOR" />
    </DashboardLayout>
  );
}

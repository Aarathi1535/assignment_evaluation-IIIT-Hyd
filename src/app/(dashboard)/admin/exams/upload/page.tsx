'use client';

import React from 'react';
import { DashboardLayout } from '@/components/ui/DashboardLayout';
import UploadUI from '@/components/UploadUI';

export default function AdminUploadPage() {
  return (
    <DashboardLayout
      title="Upload Answer Sheets (Admin)"
      description="Ingest scan packages, PDF booklets, or high-resolution images as an Administrator."
    >
      <UploadUI role="ADMIN" />
    </DashboardLayout>
  );
}

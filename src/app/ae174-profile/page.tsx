import { notFound } from 'next/navigation';
import AE174CanvasProfileHarness from '@/components/canvas/AE174CanvasProfileHarness';

export default function AE174CanvasProfilePage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <AE174CanvasProfileHarness />;
}

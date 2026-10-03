import React from 'react';
import { getServerSession } from 'next-auth';
import { notFound, redirect } from 'next/navigation';
import HandwritingProductWorkflow from '@/components/handwriting/HandwritingProductWorkflow';
import { isFeatureEnabled } from '@/config/features';
import { UserRole } from '@/constants/permissions';
import { authOptions } from '@/lib/auth';

export const metadata = {
    title: 'Handwriting Consistency',
    description: 'Analyze student answer sheets for handwriting consistency.'
};

export default async function HandwritingResearchPage() {
    const session = await getServerSession(authOptions);
    if (!session?.user) redirect('/login');

    const role = session.user.role?.toUpperCase();
    if (role !== UserRole.PROFESSOR && role !== UserRole.ADMIN) notFound();
    if (!isFeatureEnabled('HANDWRITING_CONSISTENCY')) notFound();

    return (
        <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
            <header>
                <h1 className="text-2xl font-black tracking-tight text-slate-900">Handwriting Consistency</h1>
                <p className="mt-2 max-w-3xl text-sm text-slate-600">Analyze student answer sheets for handwriting consistency.</p>
            </header>
            <HandwritingProductWorkflow />
        </main>
    );
}

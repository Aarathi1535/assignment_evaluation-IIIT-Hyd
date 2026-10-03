import React from 'react';
import HandwritingEvaluationDashboard from '@/components/handwriting/HandwritingEvaluationDashboard';
import HandwritingConsentCard from '@/components/handwriting/HandwritingConsentCard';
import HandwritingResearchDemo from '@/components/handwriting/HandwritingResearchDemo';
import { EmptyState } from '@/components/ui/EmptyState';
import { isFeatureEnabled } from '@/config/features';

export const metadata = {
    title: 'Handwriting Consistency Evaluation | Research Dashboard',
    description: 'Empirical benchmark evaluation and consent management for handwriting consistency research.'
};

export default function HandwritingResearchPage() {
    if (!isFeatureEnabled('HANDWRITING_CONSISTENCY')) {
        return (
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
                <div>
                    <h1 className="text-2xl font-black text-slate-900 tracking-tight">
                        Handwriting Consistency Research
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">
                        Direction 4: Deterministic document-analysis consistency metrics, consent tracking, and empirical false-positive rate evaluation.
                    </p>
                </div>

                <div className="max-w-2xl mx-auto py-12 px-4 text-center">
                    <EmptyState
                        title="Handwriting Consistency is Disabled"
                        description="This research feature is currently disabled by system configuration. Please enable FEATURE_HANDWRITING_CONSISTENCY to access this dashboard."
                    />
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
            <div>
                <h1 className="text-2xl font-black text-slate-900 tracking-tight">
                    Handwriting Consistency Research
                </h1>
                <p className="text-sm text-slate-500 mt-1">
                    Direction 4: Deterministic document-analysis consistency metrics, consent tracking, and empirical false-positive rate evaluation.
                </p>
            </div>

            <div className="grid grid-cols-1 gap-8">
                <HandwritingResearchDemo />
                <HandwritingEvaluationDashboard />
                <HandwritingConsentCard />
            </div>
        </div>
    );
}

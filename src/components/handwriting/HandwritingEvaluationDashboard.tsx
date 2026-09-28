'use client';

import React, { useState } from 'react';
import { AlertCircle, BarChart3, RefreshCw, CheckCircle2, XCircle } from 'lucide-react';
import { HandwritingFalsePositiveMetrics } from '../../services/handwriting/HandwritingEvaluationService';

interface HandwritingEvaluationDashboardProps {
    initialMetrics?: HandwritingFalsePositiveMetrics | null;
}

export const HandwritingEvaluationDashboard: React.FC<HandwritingEvaluationDashboardProps> = ({
    initialMetrics = null
}) => {
    const [metrics, setMetrics] = useState<HandwritingFalsePositiveMetrics | null>(initialMetrics);
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    const runBenchmark = async () => {
        try {
            setLoading(true);
            setError(null);
            const res = await fetch('/api/research/handwriting/evaluation');
            const json = await res.json();
            if (json.success && json.data) {
                setMetrics(json.data);
            } else {
                setError(json.message || 'Benchmark evaluation failed');
            }
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Error running evaluation');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="bg-white border border-slate-200 rounded-brand p-6 shadow-sm space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-100 pb-4">
                <div>
                    <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                        <BarChart3 className="h-5 w-5 text-brand-primary" />
                        Handwriting Consistency Empirical Evaluation
                    </h2>
                    <p className="text-xs text-slate-500 mt-1">
                        Cross-student evaluation measuring heuristic consistency variance and false-positive rates.
                    </p>
                </div>

                <button
                    onClick={runBenchmark}
                    disabled={loading}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-brand-primary text-white text-xs font-semibold rounded-brand hover:bg-brand-primary/90 transition-colors disabled:opacity-50 shadow-sm"
                >
                    <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                    <span>{loading ? 'Evaluating...' : 'Run Empirical Benchmark'}</span>
                </button>
            </div>

            {/* Crucial Empirical Disclaimer Alert */}
            <div className="bg-amber-50 border border-amber-200 p-4 rounded-brand flex items-start gap-3 text-xs text-amber-800">
                <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                    <span className="font-bold">Evaluation Disclaimer: </span>
                    {metrics?.disclaimer ||
                        'Empirical evaluation metric based on tested sample distribution. This metric measures geometric and statistical consistency heuristics and does NOT constitute mathematical, biometric, or legal proof of authorship.'}
                </div>
            </div>

            {error && (
                <div className="bg-rose-50 border border-rose-200 p-3 rounded-brand text-xs text-rose-700">
                    {error}
                </div>
            )}

            {metrics && (
                <div className="space-y-6">
                    {/* Key Metric KPI Cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        {/* False Positive Rate */}
                        <div className="bg-slate-50 border border-slate-200 rounded-brand p-4">
                            <span className="text-2xs font-extrabold uppercase text-slate-500 tracking-wider">
                                False-Positive Rate (FPR)
                            </span>
                            <div className="mt-2 flex items-baseline gap-2">
                                <span className="text-2xl font-black text-rose-600">
                                    {(metrics.falsePositiveRate * 100).toFixed(2)}%
                                </span>
                                <span className="text-xs text-slate-500">
                                    ({metrics.differentStudentFalseMatches} / {metrics.differentStudentComparisons})
                                </span>
                            </div>
                            <p className="text-3xs text-slate-400 mt-1">
                                Different-student pairs incorrectly accepted as MATCH
                            </p>
                        </div>

                        {/* Same-Student Match Rate */}
                        <div className="bg-slate-50 border border-slate-200 rounded-brand p-4">
                            <span className="text-2xs font-extrabold uppercase text-slate-500 tracking-wider">
                                Same-Student Match Rate (TPR)
                            </span>
                            <div className="mt-2 flex items-baseline gap-2">
                                <span className="text-2xl font-black text-emerald-600">
                                    {(metrics.sameStudentMatchRate * 100).toFixed(2)}%
                                </span>
                                <span className="text-xs text-slate-500">
                                    ({metrics.sameStudentMatches} / {metrics.sameStudentComparisons})
                                </span>
                            </div>
                            <p className="text-3xs text-slate-400 mt-1">
                                Same-student pairs correctly identified as MATCH
                            </p>
                        </div>

                        {/* Total Evaluations */}
                        <div className="bg-slate-50 border border-slate-200 rounded-brand p-4">
                            <span className="text-2xs font-extrabold uppercase text-slate-500 tracking-wider">
                                Total Pairwise Evaluations
                            </span>
                            <div className="mt-2 flex items-baseline gap-2">
                                <span className="text-2xl font-black text-slate-800">
                                    {metrics.totalEvaluations}
                                </span>
                            </div>
                            <p className="text-3xs text-slate-400 mt-1">
                                Timestamp: {new Date(metrics.evaluatedAt).toLocaleTimeString()}
                            </p>
                        </div>
                    </div>

                    {/* Breakdown Tables */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                        <div className="border border-slate-200 rounded-brand p-4 space-y-3">
                            <h4 className="font-bold text-slate-800 flex items-center gap-1.5">
                                <XCircle className="h-4 w-4 text-rose-500" />
                                Different-Student Outcomes ({metrics.differentStudentComparisons})
                            </h4>
                            <div className="space-y-1.5 text-slate-600">
                                <div className="flex justify-between py-1 border-b border-slate-100">
                                    <span className="font-medium text-rose-700">Incorrect Matches (False Positives)</span>
                                    <span className="font-bold">{metrics.differentStudentBreakdown.matches}</span>
                                </div>
                                <div className="flex justify-between py-1 border-b border-slate-100">
                                    <span>Review Required (Investigative Flag)</span>
                                    <span>{metrics.differentStudentBreakdown.reviewRequired}</span>
                                </div>
                                <div className="flex justify-between py-1 border-b border-slate-100">
                                    <span>Inconclusive Evidence</span>
                                    <span>{metrics.differentStudentBreakdown.inconclusive}</span>
                                </div>
                                <div className="flex justify-between py-1">
                                    <span>Insufficient Samples / Unassessed</span>
                                    <span>
                                        {metrics.differentStudentBreakdown.insufficientSample +
                                            metrics.differentStudentBreakdown.unassessed}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="border border-slate-200 rounded-brand p-4 space-y-3">
                            <h4 className="font-bold text-slate-800 flex items-center gap-1.5">
                                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                                Same-Student Outcomes ({metrics.sameStudentComparisons})
                            </h4>
                            <div className="space-y-1.5 text-slate-600">
                                <div className="flex justify-between py-1 border-b border-slate-100">
                                    <span className="font-medium text-emerald-700">Matches (True Positives)</span>
                                    <span className="font-bold">{metrics.sameStudentBreakdown.matches}</span>
                                </div>
                                <div className="flex justify-between py-1 border-b border-slate-100">
                                    <span>Review Required</span>
                                    <span>{metrics.sameStudentBreakdown.reviewRequired}</span>
                                </div>
                                <div className="flex justify-between py-1 border-b border-slate-100">
                                    <span>Inconclusive Evidence</span>
                                    <span>{metrics.sameStudentBreakdown.inconclusive}</span>
                                </div>
                                <div className="flex justify-between py-1">
                                    <span>Insufficient Samples / Unassessed</span>
                                    <span>
                                        {metrics.sameStudentBreakdown.insufficientSample +
                                            metrics.sameStudentBreakdown.unassessed}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default HandwritingEvaluationDashboard;

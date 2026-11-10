'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, BarChart3, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DashboardLayout } from '@/components/ui/DashboardLayout';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

interface ScoreDistributionBin {
    startPercentage: number;
    endPercentage: number;
    label: string;
    count: number;
}

interface QuestionPerformanceStatistic {
    questionNumber: number;
    maxMarks: number;
    gradedCount: number;
    meanScorePercentage: number | null;
    standardDeviationPercentagePoints: number | null;
    difficultyIndexPercentage: number | null;
}

interface QuestionMetric {
    scoreNormalization: string;
    spread: string;
    difficultyFormula: string;
}

interface ClassStatistics {
    count: number;
    mean: number | null;
    median: number | null;
    standardDeviation: number | null;
    standardDeviationMethod: 'population';
}

interface ExamAnalyticsResponse {
    exam: { id: string; title: string; maxMarks: number };
    classStatistics: ClassStatistics;
    scoreDistribution: ScoreDistributionBin[];
    questionStatistics: QuestionPerformanceStatistic[];
    questionMetric: QuestionMetric;
}

interface GraderMetric {
    graderId: string;
    graderName: string;
    name: string;
    comparisonCount: number;
    meanAbsoluteDeviationPercentagePoints: number;
    signedMeanDeviationPercentagePoints?: number;
    sampleSizeStatus: 'SUFFICIENT' | 'INSUFFICIENT';
}

interface GraderAnalyticsResponse {
    exam: { id: string; title: string };
    metric: {
        name: string;
        unit: string;
        direction: string;
        minimumSampleSize: number;
        comparisonBasis: string;
        limitation: string;
    };
    graders: GraderMetric[];
}

interface AnalyticsPayload {
    exam: ExamAnalyticsResponse;
    graders: GraderAnalyticsResponse;
}

function isSuccessfulResponse<T>(value: unknown): value is { success: true; data: T } {
    return typeof value === 'object' && value !== null &&
        'success' in value && value.success === true && 'data' in value;
}

function Histogram({ bins }: { bins: ScoreDistributionBin[] }) {
    const largestBin = Math.max(1, ...bins.map(bin => bin.count));
    const accessibleSummary = bins.map(bin => `${bin.label}: ${bin.count}`).join(', ');

    return (
        <figure aria-labelledby="score-distribution-title">
            <div
                role="img"
                aria-label={`Score distribution by percentage of maximum marks. ${accessibleSummary}`}
                className="grid grid-cols-5 gap-3 sm:grid-cols-10 sm:gap-2"
            >
                {bins.map(bin => (
                    <div key={bin.label} className="flex min-w-0 flex-col items-center gap-2">
                        <span className="text-xs font-semibold tabular-nums text-slate-700" aria-hidden="true">
                            {bin.count}
                        </span>
                        <div className="flex h-32 w-full items-end rounded-t bg-slate-100">
                            <div
                                className="w-full rounded-t bg-indigo-700"
                                style={{ height: `${(bin.count / largestBin) * 100}%` }}
                                title={`${bin.label}: ${bin.count} released grades`}
                            />
                        </div>
                        <span className="text-[0.65rem] font-medium text-slate-700">{bin.label}</span>
                    </div>
                ))}
            </div>
            <figcaption className="mt-3 text-xs text-slate-600">
                Final released scores normalized to a percentage of each student&apos;s maximum marks.
            </figcaption>
        </figure>
    );
}

function GraderConsistencyChart({
    graders,
    minimumSampleSize
}: {
    graders: GraderMetric[];
    minimumSampleSize: number;
}) {
    const maxDeviation = Math.max(
        1,
        ...graders.map(grader => grader.meanAbsoluteDeviationPercentagePoints)
    );

    if (graders.length === 0) {
        return (
            <p className="rounded-brand bg-slate-50 p-4 text-sm text-slate-700" role="status">
                There is not yet comparable released grading work from multiple TAs.
            </p>
        );
    }

    return (
        <div className="space-y-4">
            {graders.map(grader => (
                <div key={grader.graderId} className="space-y-1.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <span className="text-sm font-semibold text-slate-900">{grader.name}</span>
                        <span className="text-xs tabular-nums text-slate-700">
                            {grader.meanAbsoluteDeviationPercentagePoints.toFixed(1)} percentage points
                            {grader.signedMeanDeviationPercentagePoints !== undefined && (
                                <span className="text-slate-500">
                                    {' '}(signed: {grader.signedMeanDeviationPercentagePoints > 0 ? '+' : ''}{grader.signedMeanDeviationPercentagePoints.toFixed(1)} pp)
                                </span>
                            )}
                            {' '}({grader.comparisonCount} comparisons)
                        </span>
                    </div>
                    <div
                        role="img"
                        aria-label={`${grader.name}: ${grader.meanAbsoluteDeviationPercentagePoints.toFixed(1)} percentage points mean absolute deviation from comparable cohort scores`}
                        className="h-4 overflow-hidden rounded-full bg-slate-100"
                    >
                        <div
                            className="h-full rounded-full bg-teal-800"
                            style={{
                                width: `${Math.min(
                                    (grader.meanAbsoluteDeviationPercentagePoints / maxDeviation) * 100,
                                    100
                                )}%`
                            }}
                        />
                    </div>
                    {grader.sampleSizeStatus === 'INSUFFICIENT' && (
                        <p className="text-xs font-medium text-amber-900">
                            Small sample: at least {minimumSampleSize} comparable scores are needed for a sufficient sample.
                        </p>
                    )}
                </div>
            ))}
        </div>
    );
}

function QuestionPerformanceTable({
    questions
}: {
    questions: QuestionPerformanceStatistic[];
}) {
    if (questions.length === 0) {
        return (
            <p className="rounded-brand bg-slate-50 p-4 text-sm text-slate-700" role="status">
                No rubric questions are configured for this exam.
            </p>
        );
    }

    return (
        <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-left text-sm">
                <caption className="sr-only">Question-level mean score, spread, difficulty and valid grade count</caption>
                <thead>
                    <tr className="border-b border-slate-300 text-xs font-bold uppercase tracking-wide text-slate-700">
                        <th scope="col" className="px-3 py-3">Question</th>
                        <th scope="col" className="px-3 py-3">Maximum marks</th>
                        <th scope="col" className="px-3 py-3">Mean score</th>
                        <th scope="col" className="px-3 py-3">Score spread</th>
                        <th scope="col" className="px-3 py-3">Difficulty index</th>
                        <th scope="col" className="px-3 py-3">Valid grades</th>
                    </tr>
                </thead>
                <tbody>
                    {questions.map(question => (
                        <tr key={question.questionNumber} className="border-b border-slate-200 text-slate-800">
                            <th scope="row" className="whitespace-nowrap px-3 py-3 font-semibold">
                                Question {question.questionNumber}
                            </th>
                            <td className="whitespace-nowrap px-3 py-3 tabular-nums">
                                {question.maxMarks.toLocaleString()} marks
                            </td>
                            <td className="whitespace-nowrap px-3 py-3 tabular-nums">
                                {question.meanScorePercentage === null
                                    ? '—'
                                    : `${question.meanScorePercentage.toFixed(1)}%`}
                            </td>
                            <td className="whitespace-nowrap px-3 py-3 tabular-nums">
                                {question.standardDeviationPercentagePoints === null
                                    ? '—'
                                    : `${question.standardDeviationPercentagePoints.toFixed(1)} percentage points`}
                            </td>
                            <td className="whitespace-nowrap px-3 py-3 tabular-nums">
                                {question.difficultyIndexPercentage === null
                                    ? 'No valid final question-level grades'
                                    : `${question.difficultyIndexPercentage.toFixed(1)}% (higher is harder)`}
                            </td>
                            <td className="px-3 py-3 tabular-nums">{question.gradedCount.toLocaleString()}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export default function ExamAnalyticsDashboard({ examId }: { examId: string }) {
    const [payload, setPayload] = useState<AnalyticsPayload | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [retryToken, setRetryToken] = useState(0);

    useEffect(() => {
        const controller = new AbortController();
        async function loadAnalytics() {
            setLoading(true);
            setError(null);
            setPayload(null);
            try {
                const [examResponse, graderResponse] = await Promise.all([
                    fetch(`/api/analytics/exams/${encodeURIComponent(examId)}`, {
                        cache: 'no-store',
                        signal: controller.signal
                    }),
                    fetch(`/api/analytics/exams/${encodeURIComponent(examId)}/graders`, {
                        cache: 'no-store',
                        signal: controller.signal
                    })
                ]);
                const [examBody, graderBody]: [unknown, unknown] = await Promise.all([
                    examResponse.json(),
                    graderResponse.json()
                ]);
                if (!examResponse.ok || !isSuccessfulResponse<ExamAnalyticsResponse>(examBody)) {
                    throw new Error(
                        typeof examBody === 'object' && examBody !== null &&
                            'message' in examBody && typeof examBody.message === 'string'
                            ? examBody.message
                            : 'Could not load exam performance analytics.'
                    );
                }
                if (!graderResponse.ok || !isSuccessfulResponse<GraderAnalyticsResponse>(graderBody)) {
                    throw new Error(
                        typeof graderBody === 'object' && graderBody !== null &&
                            'message' in graderBody && typeof graderBody.message === 'string'
                            ? graderBody.message
                            : 'Could not load TA grading consistency analytics.'
                    );
                }
                setPayload({ exam: examBody.data, graders: graderBody.data });
            } catch (loadError: unknown) {
                if (controller.signal.aborted) {
                    return;
                }
                setError(loadError instanceof Error ? loadError.message : 'Could not load exam analytics.');
            } finally {
                if (!controller.signal.aborted) {
                    setLoading(false);
                }
            }
        }

        void loadAnalytics();
        return () => controller.abort();
    }, [examId, retryToken]);

    const statistics = payload?.exam.classStatistics;
    const summary = useMemo(() => statistics ? [
        { label: 'Released grades', value: statistics.count.toLocaleString() },
        { label: 'Class average', value: statistics.mean === null ? '—' : `${statistics.mean.toFixed(2)} / ${payload?.exam.exam.maxMarks}` },
        { label: 'Median', value: statistics.median === null ? '—' : `${statistics.median.toFixed(2)} / ${payload?.exam.exam.maxMarks}` },
        { label: 'Population standard deviation', value: statistics.standardDeviation === null ? '—' : statistics.standardDeviation.toFixed(2) }
    ] : [], [payload?.exam.exam.maxMarks, statistics]);

    return (
        <DashboardLayout
            title={payload?.exam.exam.title || 'Exam analytics'}
            description="Published cohort performance and grading consistency."
            maxWidth="full"
        >
            <div className="space-y-6">
                <Link
                    href="/professor/exams"
                    className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-800 hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-700 focus:ring-offset-2"
                >
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                    Back to exams
                </Link>

                {loading && (
                    <div role="status" aria-live="polite" className="flex min-h-48 flex-col items-center justify-center gap-3">
                        <LoadingSpinner size="lg" />
                        <p className="text-sm font-semibold text-slate-700">Loading exam analytics…</p>
                    </div>
                )}

                {!loading && error && (
                    <Card>
                        <div role="alert" className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
                            <AlertCircle className="h-6 w-6 shrink-0 text-rose-700" aria-hidden="true" />
                            <p className="flex-1 text-sm font-medium text-rose-900">{error}</p>
                            <Button variant="outline" onClick={() => setRetryToken(token => token + 1)}>
                                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                                Retry
                            </Button>
                        </div>
                    </Card>
                )}

                {!loading && !error && payload && (
                    <>
                        <section aria-label="Cohort performance summary" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                            {summary.map(item => (
                                <Card key={item.label}>
                                    <p className="text-xs font-bold uppercase tracking-wide text-slate-600">{item.label}</p>
                                    <p className="mt-2 text-2xl font-black tabular-nums text-slate-950">{item.value}</p>
                                </Card>
                            ))}
                        </section>

                        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                            <Card>
                                <div className="mb-5 flex items-center gap-3">
                                    <BarChart3 className="h-5 w-5 text-indigo-800" aria-hidden="true" />
                                    <h2 id="score-distribution-title" className="text-lg font-bold text-slate-950">
                                        Score distribution
                                    </h2>
                                </div>
                                {statistics?.count === 0 ? (
                                    <p className="rounded-brand bg-slate-50 p-4 text-sm text-slate-700" role="status">
                                        No published final grades are available for this exam yet.
                                    </p>
                                ) : (
                                    <Histogram bins={payload.exam.scoreDistribution} />
                                )}
                            </Card>

                            <Card>
                                <h2 className="mb-2 text-lg font-bold text-slate-950">TA grading consistency</h2>
                                <p className="mb-5 text-sm text-slate-700">
                                    Mean absolute deviation measures spread from comparable question cohort averages (lower values are closer to the cohort mean). Signed mean deviation measures grader bias (positive values indicate more lenient grading, negative values indicate stricter grading).
                                </p>
                                <GraderConsistencyChart
                                    graders={payload.graders.graders}
                                    minimumSampleSize={payload.graders.metric.minimumSampleSize}
                                />
                                <p className="mt-5 border-t border-slate-200 pt-4 text-xs leading-relaxed text-slate-700">
                                    {payload.graders.metric.limitation}
                                </p>
                            </Card>
                        </div>

                        <Card>
                            <h2 className="mb-2 text-lg font-bold text-slate-950">Question-level performance</h2>
                            <p className="mb-5 text-sm leading-relaxed text-slate-700">
                                {payload.exam.questionMetric.scoreNormalization} {payload.exam.questionMetric.spread}{' '}
                                {payload.exam.questionMetric.difficultyFormula}
                            </p>
                            <QuestionPerformanceTable questions={payload.exam.questionStatistics} />
                        </Card>
                    </>
                )}
            </div>
        </DashboardLayout>
    );
}

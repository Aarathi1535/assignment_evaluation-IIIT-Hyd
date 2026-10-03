'use client';

import React, { useState } from 'react';
import {
    ComparisonMatchState,
    type HandwritingDemoAction,
    type HandwritingDemoResult,
    type HandwritingDemoRegion
} from '../../types/handwriting-demo';

function RegionFeatures({ region }: { region: HandwritingDemoRegion }) {
    if (!region.features) {
        return <p className="mt-2 text-xs text-slate-500">Analyze the answer sheet to extract this region.</p>;
    }

    const features = region.features;
    return (
        <details className="mt-3 text-xs text-slate-700">
            <summary className="cursor-pointer font-semibold">Extracted handwriting features ({region.status})</summary>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                <dt>Ink density</dt><dd>{features.inkDensity}</dd>
                <dt>Horizontal projection variance</dt><dd>{features.horizontalProjection.variance}</dd>
                <dt>Vertical projection variance</dt><dd>{features.verticalProjection.variance}</dd>
                <dt>Line spacing</dt><dd>{features.estimatedLineSpacing}</dd>
                <dt>Stroke-width proxy</dt><dd>{features.strokeWidthProxy.mean}</dd>
                <dt>Slant</dt><dd>{features.slantAngle}°</dd>
                <dt>Connected components</dt><dd>{features.connectedComponents.count}</dd>
            </dl>
        </details>
    );
}

export default function HandwritingResearchDemo() {
    const [result, setResult] = useState<HandwritingDemoResult | null>(null);
    const [loadingAction, setLoadingAction] = useState<HandwritingDemoAction | null>(null);
    const [error, setError] = useState<string | null>(null);

    const runAction = async (action: HandwritingDemoAction) => {
        setLoadingAction(action);
        setError(null);
        try {
            const response = await fetch('/api/research/handwriting/demo', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action })
            });
            const json = await response.json() as {
                success: boolean;
                message?: string;
                data?: HandwritingDemoResult;
            };
            if (!response.ok || !json.success || !json.data) {
                throw new Error(json.message || 'Handwriting answer-sheet demo failed');
            }
            setResult(json.data);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Handwriting answer-sheet demo failed');
        } finally {
            setLoadingAction(null);
        }
    };

    const analysis = result?.analysis;
    const flaggedComparisons = analysis?.comparisons.filter(
        ({ comparison }) => comparison.status === ComparisonMatchState.REVIEW_REQUIRED
    ) ?? [];

    return (
        <section className="space-y-6 rounded-xl border border-indigo-200 bg-white p-6 shadow-sm">
            <header>
                <h2 className="text-lg font-bold text-slate-900">Synthetic Research Demo</h2>
                <p className="mt-1 text-xs font-semibold text-amber-800">Synthetic Research Demo Data</p>
                <p className="mt-2 text-sm text-slate-600">
                    No real student data is used. This research prototype provides heuristic consistency signals and is not forensic/authorship proof.
                    The Professor reviews any potential discrepancy; the system does not determine who wrote an answer.
                </p>
            </header>

            <section className="space-y-3 rounded-lg border border-slate-200 p-4" aria-labelledby="answer-sheet-heading">
                <div>
                    <h3 id="answer-sheet-heading" className="font-bold text-slate-900">1. Answer Sheet</h3>
                    <p className="mt-1 text-sm text-slate-600">Student: Student A (synthetic) · Exam: AI Fundamentals (synthetic) · Pages: 4</p>
                </div>
                <div className="flex flex-wrap gap-3">
                    <button
                        type="button"
                        onClick={() => void runAction('load')}
                        disabled={loadingAction !== null}
                        className="rounded bg-indigo-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                        {loadingAction === 'load' ? 'Loading...' : 'Load Demo Answer Sheet'}
                    </button>
                    <button
                        type="button"
                        onClick={() => void runAction('analyze')}
                        disabled={loadingAction !== null || result === null}
                        className="rounded border border-indigo-300 px-4 py-2 text-sm font-semibold text-indigo-800 disabled:opacity-50"
                    >
                        {loadingAction === 'analyze' ? 'Analyzing pages and regions...' : 'Analyze Answer Sheet'}
                    </button>
                </div>
                {loadingAction && (
                    <p className="text-sm text-indigo-800" role="status" aria-live="polite">
                        {loadingAction === 'load' ? 'Loading four synthetic answer-sheet pages...' : 'Extracting handwriting features and comparing answer regions...'}
                    </p>
                )}
                {error && <p role="alert" className="rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
            </section>

            {result && (
                <section id="answer-sheet-preview" className="space-y-4" aria-labelledby="preview-heading">
                    <div>
                        <h3 id="preview-heading" className="font-bold text-slate-900">2. Answer Sheet Preview</h3>
                        <p className="mt-1 text-sm text-slate-600">Four synthetic pages containing six answer regions.</p>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                        {result.pages.map((page) => (
                            <article key={page.pageNumber} className="rounded-lg border border-slate-200 p-3">
                                <h4 className="text-sm font-semibold text-slate-800">{page.label}</h4>
                                <img
                                    src={page.imageDataUrl}
                                    alt={`${page.label}, synthetic handwriting page`}
                                    className="mt-2 h-48 w-full rounded border border-slate-200 object-contain"
                                />
                                <ul className="mt-2 text-xs text-slate-600">
                                    {result.regions.filter((region) => region.pageNumber === page.pageNumber).map((region) => (
                                        <li key={region.regionId}>{region.label}</li>
                                    ))}
                                </ul>
                            </article>
                        ))}
                    </div>
                </section>
            )}

            {analysis && (
                <section className="space-y-4" aria-labelledby="analysis-heading">
                    <div>
                        <h3 id="analysis-heading" className="font-bold text-slate-900">3. Handwriting Analysis</h3>
                        <p className="mt-1 text-sm text-slate-600">
                            Pages analyzed: {analysis.pagesAnalyzed} · Regions analyzed: {analysis.regionsAnalyzed} · Baseline regions: {analysis.profile.sampleCount}
                        </p>
                        <p className="text-sm text-slate-600">Baseline profile: {analysis.profile.status} (minimum 3 samples required).</p>
                    </div>

                    <div className="rounded-lg border border-slate-200 p-4">
                        <h4 className="font-semibold text-slate-900">4. Analysis Result: {analysis.status}</h4>
                        {analysis.reviewRequired ? (
                            <p className="mt-2 text-sm font-semibold text-amber-900">Potential handwriting discrepancy detected. Professor review recommended.</p>
                        ) : analysis.status === ComparisonMatchState.MATCH ? (
                            <p className="mt-2 text-sm text-emerald-800">No significant handwriting discrepancy detected.</p>
                        ) : (
                            <p className="mt-2 text-sm text-amber-900">The result is inconclusive or insufficient; manual review is recommended.</p>
                        )}
                    </div>

                    <div className="space-y-3">
                        {result.regions.map((region) => {
                            const regionComparison = analysis.comparisons.find((item) => item.regionId === region.regionId);
                            return (
                                <article key={region.regionId} className="rounded-lg border border-slate-200 p-4">
                                    <h4 className="font-semibold text-slate-900">Page {region.pageNumber} · Question {region.questionNumber}</h4>
                                    {regionComparison ? (
                                        <>
                                            <p className="mt-1 text-sm font-bold text-slate-800">Engine status: {regionComparison.comparison.status}</p>
                                            <p className="text-sm text-slate-700">
                                                Distance: {regionComparison.comparison.distance} · Confidence: {regionComparison.comparison.confidence}
                                            </p>
                                            {regionComparison.comparison.featureDeviations.length > 0 && (
                                                <div className="mt-2 overflow-x-auto">
                                                    <table className="w-full min-w-[580px] border-collapse text-left text-xs">
                                                        <thead><tr className="border-b border-slate-200"><th className="py-2 pr-3">Feature</th><th className="py-2 pr-3">Baseline</th><th className="py-2 pr-3">Observed</th><th className="py-2">Deviation</th></tr></thead>
                                                        <tbody>
                                                            {regionComparison.comparison.featureDeviations.map((deviation) => (
                                                                <tr key={deviation.feature} className="border-b border-slate-100">
                                                                    <td className="py-2 pr-3">{deviation.feature}</td>
                                                                    <td className="py-2 pr-3">{deviation.baselineMean}</td>
                                                                    <td className="py-2 pr-3">{deviation.observed}</td>
                                                                    <td className="py-2">{deviation.normalizedDeviation}</td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            )}
                                            {regionComparison.comparison.anomalyFactors.length > 0 && (
                                                <ul className="mt-2 list-disc pl-5 text-xs text-slate-700">
                                                    {regionComparison.comparison.anomalyFactors.map((factor) => <li key={factor}>{factor}</li>)}
                                                </ul>
                                            )}
                                        </>
                                    ) : (
                                        <p className="mt-1 text-xs text-slate-600">Used to establish the synthetic baseline.</p>
                                    )}
                                    <RegionFeatures region={region} />
                                </article>
                            );
                        })}
                    </div>

                    {flaggedComparisons.map((flagged) => (
                        <aside key={flagged.regionId} className="rounded-lg border-2 border-amber-400 bg-amber-50 p-4" role="alert">
                            <h3 className="font-extrabold text-amber-950">Potential Handwriting Discrepancy</h3>
                            <p className="mt-1 text-sm text-amber-950">Page {flagged.pageNumber} · Question {flagged.questionNumber}</p>
                            <p className="mt-1 text-sm text-amber-900">Potential inconsistency detected. Professor review required; the Professor makes the final determination.</p>
                            <a href="#answer-sheet-preview" className="mt-3 inline-block text-sm font-semibold text-amber-950 underline">View Answer Sheet</a>
                        </aside>
                    ))}
                </section>
            )}
        </section>
    );
}

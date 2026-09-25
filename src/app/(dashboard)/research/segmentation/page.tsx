'use client';

import React, { useState } from 'react';
import { 
  FileText, 
  AlertTriangle, 
  CheckCircle, 
  Layers, 
  Search, 
  RefreshCw,
  ArrowRight
} from 'lucide-react';

interface Segment {
  segmentId: string;
  pageNumber: number;
  segmentType: 'START' | 'CONTINUATION' | 'ISOLATED' | 'UNCERTAIN';
  sequenceIndex: number;
  extractedText?: string;
  detectedHeader?: string;
  continuationMarker?: string;
  confidence: number;
  evidence: string[];
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

interface CandidateAssociation {
  questionNumber: number;
  score: number;
  reason: string;
}

interface ReconstructedAnswer {
  _id?: string;
  answerScript: string;
  exam: string;
  questionNumber: number;
  segments: Segment[];
  totalSegments: number;
  pagesInvolved: number[];
  isNonConsecutive: boolean;
  isAmbiguous: boolean;
  ambiguityReason?: string;
  candidateAssociations?: CandidateAssociation[];
  reconstructionConfidence: number;
  status: 'AUTO_RECONSTRUCTED' | 'NEEDS_REVIEW' | 'VERIFIED';
  verifiedAt?: string;
  verificationNotes?: string;
}

export default function SegmentationResearchViewer() {
  const [scriptId, setScriptId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [answers, setAnswers] = useState<ReconstructedAnswer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<number | 'all'>('all');

  const fetchSegmentation = async (id: string) => {
    if (!id.trim()) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/research/segmentation/${encodeURIComponent(id.trim())}`);
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to fetch reconstructed answers');
      }
      setAnswers(data.data || []);
      if (data.data?.length > 0) {
        setActiveTab(data.data[0].questionNumber);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
      setAnswers([]);
    } finally {
      setIsLoading(false);
    }
  };

  const verifyQuestion = async (qNum: number) => {
    if (!scriptId) return;
    try {
      const res = await fetch(`/api/research/segmentation/${encodeURIComponent(scriptId)}/question/${qNum}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: 'Verified via Answer Reconstruction Viewer' })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        alert(data.message || 'Failed to verify');
        return;
      }
      setAnswers(prev => prev.map(a => a.questionNumber === qNum ? data.data : a));
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Verification failed');
    }
  };

  const loadSyntheticDemo = () => {
    // Interactive demo data showcasing answer reconstruction
    const demoAnswers: ReconstructedAnswer[] = [
      {
        answerScript: 'sample_script_001',
        exam: 'demo_exam',
        questionNumber: 1,
        totalSegments: 2,
        pagesInvolved: [1, 7],
        isNonConsecutive: true,
        isAmbiguous: false,
        reconstructionConfidence: 0.96,
        status: 'AUTO_RECONSTRUCTED',
        segments: [
          {
            segmentId: 'seg-q1-p1',
            pageNumber: 1,
            segmentType: 'START',
            sequenceIndex: 1,
            detectedHeader: 'Q1',
            extractedText: 'Question 1: Explain the difference between CNN and Vision Transformer architectures...\n(Answer begins with mathematical formulation)',
            confidence: 0.95,
            evidence: ['EXPLICIT_HEADER:Q1', 'RUBRIC_MATCH:Q1'],
            boundingBox: { x: 0.05, y: 0.05, width: 0.9, height: 0.85 }
          },
          {
            segmentId: 'seg-q1-p7',
            pageNumber: 7,
            segmentType: 'CONTINUATION',
            sequenceIndex: 2,
            detectedHeader: 'Q1 (cont.)',
            continuationMarker: 'continued from page 1',
            extractedText: 'Q1 (cont.) continued from page 1:\nHence, self-attention scales quadratically with sequence length O(N^2) whereas standard convolutions maintain local receptive fields.',
            confidence: 0.97,
            evidence: ['EXPLICIT_CONTINUATION_MARKER:continued from page 1', 'EXPLICIT_HEADER:Q1 (cont.)', 'FORWARD_CHAIN_VALIDATED:P1->P7'],
            boundingBox: { x: 0.05, y: 0.1, width: 0.9, height: 0.75 }
          }
        ]
      },
      {
        answerScript: 'sample_script_001',
        exam: 'demo_exam',
        questionNumber: 2,
        totalSegments: 1,
        pagesInvolved: [2],
        isNonConsecutive: false,
        isAmbiguous: false,
        reconstructionConfidence: 0.95,
        status: 'AUTO_RECONSTRUCTED',
        segments: [
          {
            segmentId: 'seg-q2-p2',
            pageNumber: 2,
            segmentType: 'START',
            sequenceIndex: 1,
            detectedHeader: 'Q2',
            extractedText: 'Question 2: State the Universal Approximation Theorem and its significance.',
            confidence: 0.95,
            evidence: ['EXPLICIT_HEADER:Q2', 'RUBRIC_MATCH:Q2'],
            boundingBox: { x: 0.05, y: 0.05, width: 0.9, height: 0.9 }
          }
        ]
      },
      {
        answerScript: 'sample_script_001',
        exam: 'demo_exam',
        questionNumber: 3,
        totalSegments: 1,
        pagesInvolved: [3],
        isNonConsecutive: false,
        isAmbiguous: false,
        reconstructionConfidence: 0.95,
        status: 'AUTO_RECONSTRUCTED',
        segments: [
          {
            segmentId: 'seg-q3-p3',
            pageNumber: 3,
            segmentType: 'START',
            sequenceIndex: 1,
            detectedHeader: 'Q3',
            extractedText: 'Question 3: Derive backpropagation equations for a 2-layer perceptron.',
            confidence: 0.95,
            evidence: ['EXPLICIT_HEADER:Q3', 'RUBRIC_MATCH:Q3']
          }
        ]
      },
      {
        answerScript: 'sample_script_001',
        exam: 'demo_exam',
        questionNumber: 4,
        totalSegments: 1,
        pagesInvolved: [8],
        isNonConsecutive: false,
        isAmbiguous: true,
        ambiguityReason: 'Multiple question candidates plausible: Q2 (0.55), Q4 (0.45)',
        candidateAssociations: [
          { questionNumber: 2, score: 0.55, reason: 'Topic similarity with optimization algorithms' },
          { questionNumber: 4, score: 0.45, reason: 'Consecutive question slot in rubric' }
        ],
        reconstructionConfidence: 0.55,
        status: 'NEEDS_REVIEW',
        segments: [
          {
            segmentId: 'seg-q4-p8',
            pageNumber: 8,
            segmentType: 'UNCERTAIN',
            sequenceIndex: 1,
            extractedText: '...moreover the learning rate schedule cosine annealing helps avoid local minima.\n(Header omitted by student)',
            confidence: 0.55,
            evidence: ['UNLABELLED_DISTAL_TEXT', 'NO_FORWARD_POINTER', 'MULTIPLE_CANDIDATES:Q2,Q4']
          }
        ]
      }
    ];

    setAnswers(demoAnswers);
    setScriptId('demo-script-distal-continuation');
    setActiveTab(1);
    setError(null);
  };

  const displayedAnswers = activeTab === 'all' 
    ? answers 
    : answers.filter(a => a.questionNumber === activeTab);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
      {/* Feature Header */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 rounded-2xl p-6 text-white shadow-xl border border-indigo-900/50">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight">
              Question–Answer Reconstruction &amp; Segmentation Viewer
            </h1>
            <p className="text-sm text-indigo-200 max-w-3xl leading-relaxed">
              Automatically reconstruct complete answers across pages, including non-consecutive and out-of-order responses, before evaluation.
            </p>
          </div>
          <button
            onClick={loadSyntheticDemo}
            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-xl text-sm transition shadow-lg flex items-center gap-2 self-start md:self-center shrink-0 border border-indigo-400/40"
          >
            <Layers className="w-4 h-4" />
            Load Sample Preview
          </button>
        </div>

        {/* Info Banner */}
        <div className="mt-4 pt-4 border-t border-indigo-800/60 flex items-start gap-2.5 text-xs text-amber-200/90">
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
          <span>
            <strong>Review required:</strong> Ambiguous page associations are preserved and clearly flagged for manual verification.
          </span>
        </div>
      </div>

      {/* Script Search & Actions */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex flex-col sm:flex-row gap-3 items-center">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Enter AnswerScript MongoDB ObjectId (e.g., 60c72b2f9b1d8b2bad58...) "
            value={scriptId}
            onChange={(e) => setScriptId(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
          />
        </div>
        <button
          onClick={() => fetchSegmentation(scriptId)}
          disabled={isLoading || !scriptId.trim()}
          className="w-full sm:w-auto px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-sm font-medium transition disabled:opacity-50 flex items-center justify-center gap-2 shrink-0"
        >
          {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          Reconstruct / Inspect
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 text-red-500" />
          <span>{error}</span>
        </div>
      )}

      {/* Questions Tabs */}
      {answers.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 border-b border-slate-200">
          <button
            onClick={() => setActiveTab('all')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
              activeTab === 'all'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            All Questions ({answers.length})
          </button>
          {answers.map(ans => (
            <button
              key={ans.questionNumber}
              onClick={() => setActiveTab(ans.questionNumber)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition flex items-center gap-2 shrink-0 ${
                activeTab === ans.questionNumber
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              <span>Question {ans.questionNumber}</span>
              {ans.isNonConsecutive && (
                <span className="w-2 h-2 rounded-full bg-amber-400" title="Non-consecutive distal pages" />
              )}
              {ans.isAmbiguous && (
                <span className="w-2 h-2 rounded-full bg-red-400" title="Ambiguous / Needs Review" />
              )}
            </button>
          ))}
        </div>
      )}

      {/* Reconstructed Answer Cards */}
      <div className="space-y-6">
        {displayedAnswers.map(ans => (
          <div 
            key={ans.questionNumber} 
            className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden transition"
          >
            {/* Card Header */}
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-700 font-bold text-lg flex items-center justify-center">
                  Q{ans.questionNumber}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-semibold text-slate-900">
                      Question {ans.questionNumber}
                    </h2>
                    {ans.isNonConsecutive && (
                      <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-xs font-semibold rounded-full border border-amber-300">
                        ⚡ Non-Consecutive Pages ({ans.pagesInvolved.join(', ')})
                      </span>
                    )}
                    {ans.isAmbiguous ? (
                      <span className="px-2 py-0.5 bg-red-100 text-red-800 text-xs font-semibold rounded-full border border-red-300 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> Needs Review
                      </span>
                    ) : ans.status === 'VERIFIED' ? (
                      <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-xs font-semibold rounded-full border border-emerald-300 flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" /> Verified
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 bg-blue-100 text-blue-800 text-xs font-semibold rounded-full border border-blue-300">
                        Auto Reconstructed
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {ans.totalSegments} segment{ans.totalSegments !== 1 ? 's' : ''} across page{ans.pagesInvolved.length !== 1 ? 's' : ''} {ans.pagesInvolved.join(', ')}
                  </p>
                </div>
              </div>

              {/* Confidence & Verification */}
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-xs text-slate-400 font-medium">Confidence Score</div>
                  <div className="text-sm font-bold font-mono text-slate-700">
                    {(ans.reconstructionConfidence * 100).toFixed(0)}%
                  </div>
                </div>

                {ans.status !== 'VERIFIED' && (
                  <button
                    onClick={() => verifyQuestion(ans.questionNumber)}
                    className="px-3 py-1.5 bg-white hover:bg-emerald-50 text-slate-700 hover:text-emerald-700 border border-slate-300 hover:border-emerald-300 rounded-lg text-xs font-medium transition flex items-center gap-1.5"
                  >
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                    Verify
                  </button>
                )}
              </div>
            </div>

            {/* Ambiguity Alert Box */}
            {ans.isAmbiguous && ans.ambiguityReason && (
              <div className="mx-6 mt-4 p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm">
                <div className="flex items-center gap-2 text-amber-900 font-semibold mb-1">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  Ambiguity Detected — Segment Preserved Without Loss
                </div>
                <p className="text-amber-800 text-xs leading-relaxed mb-2">
                  {ans.ambiguityReason}
                </p>
                {ans.candidateAssociations && ans.candidateAssociations.length > 0 && (
                  <div className="space-y-1">
                    <span className="text-xs font-semibold text-amber-900">Plausible Candidate Questions:</span>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {ans.candidateAssociations.map((c, idx) => (
                        <div key={idx} className="bg-white/80 border border-amber-300 px-2.5 py-1 rounded text-xs font-mono text-amber-900">
                          Q{c.questionNumber}: {(c.score * 100).toFixed(0)}% ({c.reason})
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Segments Timeline / Breakdown */}
            <div className="p-6 space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Reconstructed Segment Sequence
              </h3>

              <div className="space-y-3 relative before:absolute before:left-4 before:top-3 before:bottom-3 before:w-0.5 before:bg-slate-200">
                {ans.segments.map((seg) => (
                  <div key={seg.segmentId} className="relative pl-9">
                    {/* Step Icon */}
                    <div className="absolute left-2 top-2 -translate-x-1/2 w-5 h-5 rounded-full bg-white border-2 border-indigo-600 text-indigo-600 flex items-center justify-center text-[10px] font-bold">
                      {seg.sequenceIndex}
                    </div>

                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2 hover:border-indigo-300 transition">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-900">
                            Page {seg.pageNumber}
                          </span>
                          {seg.segmentType === 'START' && (
                            <span className="px-2 py-0.5 bg-blue-100 text-blue-800 text-[11px] font-medium rounded">
                              Start
                            </span>
                          )}
                          {seg.segmentType === 'CONTINUATION' && (
                            <span className="px-2 py-0.5 bg-purple-100 text-purple-800 text-[11px] font-medium rounded flex items-center gap-1">
                              <ArrowRight className="w-3 h-3" /> Continued
                            </span>
                          )}
                          {seg.segmentType === 'UNCERTAIN' && (
                            <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-[11px] font-medium rounded">
                              Uncertain
                            </span>
                          )}
                          {seg.detectedHeader && (
                            <span className="text-xs font-mono bg-slate-200 px-2 py-0.5 rounded text-slate-700">
                              Header: {seg.detectedHeader}
                            </span>
                          )}
                          {seg.continuationMarker && (
                            <span className="text-xs font-mono bg-purple-100 text-purple-800 px-2 py-0.5 rounded">
                              Marker: {seg.continuationMarker}
                            </span>
                          )}
                        </div>

                        {seg.boundingBox && (
                          <span className="text-[11px] font-mono text-slate-400">
                            Box: [{seg.boundingBox.x}, {seg.boundingBox.y}, {seg.boundingBox.width}, {seg.boundingBox.height}]
                          </span>
                        )}
                      </div>

                      {/* Extracted Text */}
                      {seg.extractedText && (
                        <div className="bg-white border border-slate-200 rounded-lg p-3 text-xs text-slate-700 font-mono whitespace-pre-wrap leading-relaxed">
                          {seg.extractedText}
                        </div>
                      )}

                      {/* Evidence Tags */}
                      <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        <span className="text-[11px] font-semibold text-slate-400">Evidence:</span>
                        {seg.evidence.map((ev, evIdx) => (
                          <span 
                            key={evIdx}
                            className="px-2 py-0.5 bg-slate-200/80 text-slate-700 text-[10px] font-mono rounded"
                          >
                            {ev}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}

        {answers.length === 0 && !isLoading && !error && (
          <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-12 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto">
              <FileText className="w-6 h-6" />
            </div>
            <h3 className="text-base font-semibold text-slate-900">
              No Reconstructed Answers Loaded
            </h3>
            <p className="text-sm text-slate-500 max-w-md mx-auto">
              Enter an AnswerScript ID above to reconstruct and inspect answer segments, or click &ldquo;Load Sample Preview&rdquo; to explore answer reconstruction.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

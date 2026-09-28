'use client';

import React, { useState, useEffect } from 'react';
import { ShieldCheck, ShieldAlert, Clock, AlertCircle } from 'lucide-react';

interface ConsentData {
    studentId: string;
    hasConsented: boolean;
    consentedAt?: string | null;
    revokedAt?: string | null;
    retentionDays: number;
    retentionExpiresAt?: string | null;
    consentVersion: string;
}

interface HandwritingConsentCardProps {
    studentId?: string;
    readOnly?: boolean;
}

export const HandwritingConsentCard: React.FC<HandwritingConsentCardProps> = ({
    studentId,
    readOnly = false
}) => {
    const [consent, setConsent] = useState<ConsentData | null>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const [saving, setSaving] = useState<boolean>(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const fetchConsent = async () => {
        try {
            setLoading(true);
            const url = studentId
                ? `/api/research/handwriting/consent?studentId=${studentId}`
                : '/api/research/handwriting/consent';
            const res = await fetch(url);
            const json = await res.json();
            if (json.success && json.data) {
                setConsent(json.data);
            } else {
                setError(json.message || 'Failed to fetch consent data');
            }
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Network error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchConsent();
    }, [studentId]);

    const handleToggleConsent = async (newConsentValue: boolean) => {
        try {
            setSaving(true);
            setMessage(null);
            setError(null);

            const res = await fetch('/api/research/handwriting/consent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    studentId,
                    hasConsented: newConsentValue,
                    retentionDays: 365
                })
            });
            const json = await res.json();
            if (json.success && json.data) {
                setConsent(json.data);
                setMessage(
                    newConsentValue
                        ? 'Consent recorded. Retention period set to 365 days.'
                        : 'Consent revoked. Active analysis disabled.'
                );
            } else {
                setError(json.message || 'Failed to update consent');
            }
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Error updating consent');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="p-6 bg-white border border-slate-200 rounded-brand shadow-sm animate-pulse text-sm text-slate-500">
                Loading handwriting consent settings...
            </div>
        );
    }

    const hasConsented = consent?.hasConsented ?? false;

    return (
        <div className="bg-white border border-slate-200 rounded-brand p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    {hasConsented ? (
                        <div className="h-10 w-10 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
                            <ShieldCheck className="h-6 w-6" />
                        </div>
                    ) : (
                        <div className="h-10 w-10 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center">
                            <ShieldAlert className="h-6 w-6" />
                        </div>
                    )}
                    <div>
                        <h3 className="text-base font-bold text-slate-900">
                            Handwriting Consistency Research Consent
                        </h3>
                        <p className="text-xs text-slate-500">
                            Strictly research-focused consistency evaluation. Does not prove authorship.
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <span
                        className={`px-2.5 py-1 text-xs font-bold rounded-full ${
                            hasConsented
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-slate-100 text-slate-600'
                        }`}
                    >
                        {hasConsented ? 'Consent Active' : 'Consent Not Given'}
                    </span>
                </div>
            </div>

            <div className="text-xs text-slate-600 space-y-2 bg-slate-50 p-4 rounded-brand border border-slate-100">
                <div className="flex items-start gap-2">
                    <Clock className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
                    <div>
                        <span className="font-semibold text-slate-700">Explicit Retention Policy: </span>
                        Samples and mathematical profile feature vectors are retained for a maximum of 365 days
                        (1 academic year) from acquisition or until consent revocation. Expired data is excluded
                        from all active baseline calculations and comparisons.
                    </div>
                </div>

                {consent?.consentedAt && (
                    <div className="text-slate-500 pl-6">
                        Consent Recorded: {new Date(consent.consentedAt).toLocaleDateString()} at{' '}
                        {new Date(consent.consentedAt).toLocaleTimeString()}
                    </div>
                )}
                {consent?.retentionExpiresAt && (
                    <div className="text-slate-500 pl-6">
                        Active Retention Expiry: {new Date(consent.retentionExpiresAt).toLocaleDateString()}
                    </div>
                )}
                {consent?.revokedAt && (
                    <div className="text-rose-600 pl-6 font-medium">
                        Consent Revoked: {new Date(consent.revokedAt).toLocaleDateString()}
                    </div>
                )}
            </div>

            {error && (
                <div className="flex items-center gap-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 p-3 rounded-brand">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            {message && (
                <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 p-3 rounded-brand">
                    {message}
                </div>
            )}

            {!readOnly && (
                <div className="pt-2 flex justify-end gap-3">
                    {hasConsented ? (
                        <button
                            onClick={() => handleToggleConsent(false)}
                            disabled={saving}
                            className="px-4 py-2 text-xs font-semibold rounded-brand border border-rose-200 text-rose-600 hover:bg-rose-50 transition-colors disabled:opacity-50"
                        >
                            {saving ? 'Revoking...' : 'Revoke Consent'}
                        </button>
                    ) : (
                        <button
                            onClick={() => handleToggleConsent(true)}
                            disabled={saving}
                            className="px-4 py-2 text-xs font-semibold rounded-brand bg-brand-primary text-white hover:bg-brand-primary/90 transition-colors disabled:opacity-50 shadow-sm"
                        >
                            {saving ? 'Saving...' : 'Grant Consent (365 Days)'}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

export default HandwritingConsentCard;

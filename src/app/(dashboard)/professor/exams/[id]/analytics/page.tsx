import ExamAnalyticsDashboard from '@/components/analytics/ExamAnalyticsDashboard';

export default async function ExamAnalyticsPage({
    params
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    return <ExamAnalyticsDashboard examId={id} />;
}

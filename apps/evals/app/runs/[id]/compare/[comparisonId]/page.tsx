import { RunDetail } from '@/components/run-detail';

export default async function ComparisonDetailPage({
  params,
}: {
  params: Promise<{ id: string; comparisonId: string }>;
}) {
  const { id, comparisonId } = await params;
  return <RunDetail runId={id} comparisonId={comparisonId} />;
}

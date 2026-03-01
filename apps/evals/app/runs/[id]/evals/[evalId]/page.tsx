import { RunDetail } from '@/components/run-detail';

export default async function EvalDetailPage({
  params,
}: {
  params: Promise<{ id: string; evalId: string }>;
}) {
  const { id, evalId } = await params;
  return <RunDetail runId={id} evalId={evalId} />;
}

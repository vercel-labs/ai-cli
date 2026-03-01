import { RunDetail } from '@/components/run-detail';

export default async function RunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <RunDetail runId={id} />;
}

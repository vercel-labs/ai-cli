import { redirect } from 'next/navigation';

export default async function RunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/?run=${id}`);
}

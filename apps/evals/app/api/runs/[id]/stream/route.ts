import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { evalRuns, evalTasks } from '@/lib/db/schema';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      let isTerminal = false;

      while (!isTerminal) {
        const run = await db
          .select()
          .from(evalRuns)
          .where(eq(evalRuns.id, id))
          .limit(1);

        if (run.length === 0) {
          send({ error: 'Run not found' });
          controller.close();
          return;
        }

        const tasks = await db
          .select()
          .from(evalTasks)
          .where(eq(evalTasks.runId, id));

        send({ ...run[0], tasks });

        isTerminal = ['completed', 'failed'].includes(run[0].status);

        if (!isTerminal) {
          await new Promise((r) => setTimeout(r, 2000));
        }
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

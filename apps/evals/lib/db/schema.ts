import {
  doublePrecision,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const taskStatusEnum = pgEnum('task_status', [
  'pending',
  'running',
  'completed',
  'failed',
]);

export const evalRuns = pgTable('eval_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  status: taskStatusEnum('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export const evalTasks = pgTable('eval_tasks', {
  id: uuid('id').defaultRandom().primaryKey(),
  runId: uuid('run_id')
    .notNull()
    .references(() => evalRuns.id, { onDelete: 'cascade' }),
  evalName: text('eval_name').notNull(),
  model: text('model').notNull(),
  status: taskStatusEnum('status').notNull().default('pending'),
  tokens: integer('tokens'),
  cost: doublePrecision('cost'),
  steps: integer('steps'),
  toolCalls: integer('tool_calls'),
  durationMs: integer('duration_ms'),
  output: text('output'),
  error: text('error'),
  exitCode: integer('exit_code'),
  logs: text('logs'),
  judgeScore: doublePrecision('judge_score'),
  judgeVerdict: text('judge_verdict'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export type EvalRun = typeof evalRuns.$inferSelect;
export type EvalTask = typeof evalTasks.$inferSelect;

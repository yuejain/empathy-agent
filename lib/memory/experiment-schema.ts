import { z } from 'zod';

export const experimentFields = ['hypothesis','plan','measure','result','learning','adjustment','values','constraints','direction'] as const;
export type ExperimentField = typeof experimentFields[number];
export const experimentFieldSchema = z.enum(experimentFields);
const evidence = z.object({ text:z.string().min(1).max(500), at:z.number().finite().nonnegative(),
  sessionId:z.string().max(180), turnId:z.string().max(100), source:z.enum(['user','manual']) }).strict();
export const experimentCycleSchema = z.object({ id:z.string().uuid(), createdAt:z.number().finite().nonnegative(), updatedAt:z.number().finite().nonnegative(),
  status:z.enum(['draft','running','awaiting_review','reviewed','cancelled']),
  hypothesis:evidence.optional(), plan:evidence.optional(), measure:evidence.optional(), result:evidence.optional(),
  learning:evidence.optional(), adjustment:evidence.optional(), values:evidence.optional(), constraints:evidence.optional(), direction:evidence.optional(),
}).strict();
export const experimentSchema = z.object({ cycles:z.array(experimentCycleSchema).min(1).max(8) }).strict();
export type ExperimentCycle = z.infer<typeof experimentCycleSchema>;
export const experimentOperationSchema = z.object({
  operation:z.enum(['save','start','complete','review','iterate','cancel','remove']),
  fields:z.object(Object.fromEntries(experimentFields.map(k=>[k,z.string().max(500).nullable().optional()])) as Record<ExperimentField,z.ZodOptional<z.ZodNullable<z.ZodString>>>).strict().optional(),
}).strict();
export type ExperimentOperation = z.infer<typeof experimentOperationSchema>;

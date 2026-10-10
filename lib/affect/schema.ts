import { z } from 'zod';

const unit=z.number().finite().min(0).max(1);
export const appraisalSignalSchema=z.enum(['progress','setback','distress','relief','discovery','correction','boundary','appreciation']);
export type AppraisalSignal=z.infer<typeof appraisalSignalSchema>;
export const appraisalSchema=z.object({signal:appraisalSignalSchema,quote:z.string().min(2).max(300),confidence:unit}).strict();
export type Appraisal=z.infer<typeof appraisalSchema>;
export const affectVectorSchema=z.object({valence:z.number().finite().min(-1).max(1),arousal:unit,warmth:unit,concern:unit,curiosity:unit}).strict();
export type AffectVector=z.infer<typeof affectVectorSchema>;
export const affectStateSchema=z.object({
  epoch:z.number().int().nonnegative(),updatedAt:z.number().finite().nonnegative(),turns:z.number().int().nonnegative(),
  feeling:affectVectorSchema,mood:affectVectorSchema,
  events:z.array(z.object({signal:appraisalSignalSchema,confidence:unit,source:z.enum(['merged','local'])}).strict()).max(3),
}).strict();
export type AffectState=z.infer<typeof affectStateSchema>;
export const affectSchema=z.object({enabled:z.boolean(),state:affectStateSchema.optional()}).strict();

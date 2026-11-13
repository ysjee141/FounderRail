import { z } from "zod";
import { AGENT_IDS } from "../agents/types.js";

const timeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const common = {
  id: z.string().regex(/^[a-z0-9-]+$/),
  workflow_id: z.string().regex(/^[a-z0-9-]+$/),
  timezone: z.string().min(1).refine((value) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
      return true;
    } catch {
      return false;
    }
  }, "Invalid IANA timezone"),
  at: timeSchema,
  catch_up_hours: z.number().int().min(1).max(744),
  owner_agent: z.enum(AGENT_IDS),
  objective: z.string().min(1),
  why: z.string().min(1),
  enabled: z.boolean().default(true),
};

export const scheduleDefinitionSchema = z.discriminatedUnion("cadence", [
  z.object({ ...common, cadence: z.literal("weekly"), weekday: z.number().int().min(1).max(7) }).strict(),
  z.object({ ...common, cadence: z.literal("monthly"), day: z.number().int().min(1).max(28) }).strict(),
]);

export const scheduleFileSchema = z.object({
  version: z.literal(1),
  schedules: z.array(scheduleDefinitionSchema),
}).strict();

export type ScheduleDefinition = z.infer<typeof scheduleDefinitionSchema>;

export interface ScheduleDueSlot {
  scheduleId: string;
  slot: string;
  scheduledAt: string;
}

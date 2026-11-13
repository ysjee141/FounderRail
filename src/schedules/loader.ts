import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { scheduleFileSchema, type ScheduleDefinition } from "./types.js";

export async function loadSchedules(root: string): Promise<ScheduleDefinition[]> {
  const directory = path.join(root, "schedules");
  const entries = await readdir(directory, { withFileTypes: true });
  const schedules: ScheduleDefinition[] = [];
  for (const entry of entries.filter((item) => item.isFile() && /\.ya?ml$/.test(item.name)).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = scheduleFileSchema.parse(parse(await readFile(path.join(directory, entry.name), "utf8")));
    schedules.push(...file.schedules);
  }
  const seen = new Set<string>();
  for (const schedule of schedules) {
    if (seen.has(schedule.id)) throw new Error(`Duplicate schedule id: ${schedule.id}`);
    seen.add(schedule.id);
  }
  return schedules;
}

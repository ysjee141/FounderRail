import type { TaskStore } from "../store/task-store.js";
import type { ScheduleDefinition, ScheduleDueSlot } from "./types.js";

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

function localParts(date: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    weekday: WEEKDAYS[get("weekday")] ?? 0,
  };
}

function calendarShift(year: number, month: number, day: number, days: number): { year: number; month: number; day: number } {
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

function zonedDateTime(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wanted;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const actual = localParts(new Date(guess), timeZone);
    const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute);
    const correction = wanted - represented;
    guess += correction;
    if (correction === 0) break;
  }
  const result = new Date(guess);
  const roundTrip = localParts(result, timeZone);
  if (roundTrip.year !== year || roundTrip.month !== month || roundTrip.day !== day || roundTrip.hour !== hour || roundTrip.minute !== minute) {
    throw new Error(`Scheduled local time does not exist in ${timeZone}: ${year}-${month}-${day} ${hour}:${minute}`);
  }
  return result;
}

function latestCalendarDate(schedule: ScheduleDefinition, now: Date): { year: number; month: number; day: number } {
  const local = localParts(now, schedule.timezone);
  if (schedule.cadence === "weekly") {
    return calendarShift(local.year, local.month, local.day, -((local.weekday - schedule.weekday + 7) % 7));
  }
  if (local.day >= schedule.day) return { year: local.year, month: local.month, day: schedule.day };
  const previousMonth = new Date(Date.UTC(local.year, local.month - 2, 1));
  return { year: previousMonth.getUTCFullYear(), month: previousMonth.getUTCMonth() + 1, day: schedule.day };
}

export function dueSlot(schedule: ScheduleDefinition, now = new Date()): ScheduleDueSlot | undefined {
  if (!schedule.enabled) return undefined;
  const [hourText, minuteText] = schedule.at.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  let date = latestCalendarDate(schedule, now);
  let scheduled = zonedDateTime(date.year, date.month, date.day, hour, minute, schedule.timezone);
  if (scheduled.getTime() > now.getTime()) {
    if (schedule.cadence === "weekly") date = calendarShift(date.year, date.month, date.day, -7);
    else {
      const previousMonth = new Date(Date.UTC(date.year, date.month - 2, 1));
      date = { year: previousMonth.getUTCFullYear(), month: previousMonth.getUTCMonth() + 1, day: schedule.day };
    }
    scheduled = zonedDateTime(date.year, date.month, date.day, hour, minute, schedule.timezone);
  }
  if (now.getTime() - scheduled.getTime() > schedule.catch_up_hours * 60 * 60 * 1_000) return undefined;
  const dateText = `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
  return { scheduleId: schedule.id, slot: `${dateText}T${schedule.at}@${schedule.timezone}`, scheduledAt: scheduled.toISOString() };
}

export function tickSchedules(store: TaskStore, schedules: ScheduleDefinition[], now = new Date()) {
  return schedules.flatMap((schedule) => {
    const due = dueSlot(schedule, now);
    if (!due) return [];
    const result = store.createScheduledDraft(schedule.id, due.slot, due.scheduledAt, {
      owner_agent: schedule.owner_agent,
      objective: schedule.objective,
      why: schedule.why,
      inputs: [`workflow:${schedule.workflow_id}`, `schedule:${schedule.id}`, `slot:${due.slot}`],
      scope: { writable_paths: [], forbidden_actions: [] },
      acceptance: [`Run workflow ${schedule.workflow_id} for scheduled slot ${due.slot}`],
      checks: [],
      risk_flags: [],
      approval: { required_for: [] },
    });
    return [{ schedule, due, ...result }];
  });
}

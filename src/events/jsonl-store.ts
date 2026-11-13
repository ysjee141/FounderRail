import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { RuntimeEvent } from "../runtime/types.js";

export class JsonlEventStore {
  constructor(private readonly directory: string) {}

  async append(event: RuntimeEvent): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await appendFile(path.join(this.directory, `${event.runId}.jsonl`), `${JSON.stringify(event)}\n`);
  }
}

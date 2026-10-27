import { renameSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";

// Readers see absence or a complete document, never the temporary write.
export function publishAtomic(file: string, write: (temporary: string) => void) {
  const temporary = `${file}.tmp-${randomUUID()}`;
  try {
    write(temporary);
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

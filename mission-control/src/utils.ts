// mission-control/src/utils.ts
import { randomUUID } from "node:crypto";

export function generateId(): string {
  return randomUUID();
}

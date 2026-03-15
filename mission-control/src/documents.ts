// mission-control/src/documents.ts
import { STAGE_SENTINEL } from "./types.js";
import type { MissionControlDb } from "./db.js";

export function setDocumentPath(
  db: MissionControlDb,
  pipelineId: string,
  stage: string,
  step: string | undefined,
  path: string
): void {
  const stepValue = step || STAGE_SENTINEL;
  db.raw
    .prepare(
      `INSERT INTO document_paths (pipeline_id, stage, step, path) VALUES (?, ?, ?, ?)
       ON CONFLICT (pipeline_id, stage, step) DO UPDATE SET path = excluded.path`
    )
    .run(pipelineId, stage, stepValue, path);
}

export function getDocumentPath(
  db: MissionControlDb,
  pipelineId: string,
  stage: string,
  step?: string
): string | null {
  const stepValue = step || STAGE_SENTINEL;
  const row = db.raw
    .prepare(
      "SELECT path FROM document_paths WHERE pipeline_id = ? AND stage = ? AND step = ?"
    )
    .get(pipelineId, stage, stepValue) as { path: string } | undefined;
  return row?.path ?? null;
}

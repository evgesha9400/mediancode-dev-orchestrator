// mission-control/src/progress.ts
import { STAGE_SENTINEL } from "./types.js";
import type { MissionControlDb } from "./db.js";
import type { StageProgress, StepProgress } from "./types.js";

export function updateStepStatus(
  db: MissionControlDb,
  featureId: string,
  stage: string,
  step: string | undefined,
  status: "pending" | "in_progress" | "completed" | "skipped"
): void {
  const stepValue = step || STAGE_SENTINEL;
  const now = new Date().toISOString();

  const existing = db.raw
    .prepare(
      "SELECT id FROM stage_progress WHERE feature_id = ? AND stage = ? AND step = ?"
    )
    .get(featureId, stage, stepValue) as { id: string } | undefined;

  if (!existing) {
    throw new Error(
      `No progress row for feature=${featureId} stage=${stage} step=${stepValue}`
    );
  }

  if (status === "in_progress") {
    db.raw
      .prepare(
        "UPDATE stage_progress SET status = ?, started_at = COALESCE(started_at, ?) WHERE feature_id = ? AND stage = ? AND step = ?"
      )
      .run(status, now, featureId, stage, stepValue);
  } else if (status === "completed" || status === "skipped") {
    db.raw
      .prepare(
        "UPDATE stage_progress SET status = ?, completed_at = ? WHERE feature_id = ? AND stage = ? AND step = ?"
      )
      .run(status, now, featureId, stage, stepValue);
  } else {
    db.raw
      .prepare(
        "UPDATE stage_progress SET status = ? WHERE feature_id = ? AND stage = ? AND step = ?"
      )
      .run(status, featureId, stage, stepValue);
  }
}

export function getFeatureProgress(
  db: MissionControlDb,
  featureId: string
): StageProgress[] {
  return buildStageProgress(db, featureId);
}

export function buildStageProgress(
  db: MissionControlDb,
  featureId: string
): StageProgress[] {
  const rows = db.raw
    .prepare(
      "SELECT stage, step, status, started_at, completed_at FROM stage_progress WHERE feature_id = ? ORDER BY rowid"
    )
    .all(featureId) as {
    stage: string;
    step: string;
    status: string;
    started_at: string | null;
    completed_at: string | null;
  }[];

  const artifacts = db.raw
    .prepare(
      "SELECT id, feature_id, stage, step, type, content, created_at FROM artifacts WHERE feature_id = ?"
    )
    .all(featureId) as {
    id: string;
    feature_id: string;
    stage: string;
    step: string;
    type: string;
    content: string;
    created_at: string;
  }[];

  const stageMap = new Map<string, StageProgress>();

  // First pass: create stage entries
  for (const row of rows) {
    if (row.step === STAGE_SENTINEL) {
      stageMap.set(row.stage, {
        stage: row.stage,
        status: row.status as StageProgress["status"],
        artifacts: artifacts
          .filter((a) => a.stage === row.stage && a.step === STAGE_SENTINEL)
          .map((a) => ({
            id: a.id,
            feature_id: a.feature_id,
            stage: a.stage,
            step: a.step,
            type: a.type,
            content: a.content,
            created_at: a.created_at,
          })),
        started_at: row.started_at || undefined,
        completed_at: row.completed_at || undefined,
      });
    }
  }

  // Second pass: add step progress to stages
  for (const row of rows) {
    if (row.step !== STAGE_SENTINEL) {
      const stage = stageMap.get(row.stage);
      if (stage) {
        if (!stage.step_progress) stage.step_progress = [];
        stage.step_progress.push({
          step: row.step,
          status: row.status as StepProgress["status"],
          artifacts: artifacts
            .filter((a) => a.stage === row.stage && a.step === row.step)
            .map((a) => ({
              id: a.id,
              feature_id: a.feature_id,
              stage: a.stage,
              step: a.step,
              type: a.type,
              content: a.content,
              created_at: a.created_at,
            })),
          started_at: row.started_at || undefined,
          completed_at: row.completed_at || undefined,
        });
      }
    }
  }

  // Return in insertion order
  const result: StageProgress[] = [];
  for (const row of rows) {
    if (row.step === STAGE_SENTINEL && stageMap.has(row.stage)) {
      result.push(stageMap.get(row.stage)!);
      stageMap.delete(row.stage);
    }
  }
  return result;
}

// mission-control/src/features.ts
import { generateId } from "./utils.js";
import { STAGE_SENTINEL } from "./types.js";
import { getPipeline } from "./pipelines.js";
import { buildStageProgress } from "./progress.js";
import { getNotes } from "./artifacts.js";
import type { MissionControlDb } from "./db.js";
import type { Feature, Node, ServiceLink } from "./types.js";

export function createFeature(
  db: MissionControlDb,
  params: {
    title: string;
    description: string;
    pipeline_id: string;
    metadata?: Record<string, unknown>;
  }
): Feature {
  const pipeline = getPipeline(db, params.pipeline_id);
  if (!pipeline) {
    throw new Error(`Pipeline not found: ${params.pipeline_id}`);
  }

  const id = generateId();
  const firstStage = pipeline.stages[0].name;
  const now = new Date().toISOString();

  db.raw
    .prepare(
      "INSERT INTO features (id, title, description, pipeline_id, current_stage, status, weight, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', 0, ?, ?, ?)"
    )
    .run(
      id,
      params.title,
      params.description,
      params.pipeline_id,
      firstStage,
      params.metadata ? JSON.stringify(params.metadata) : null,
      now,
      now
    );

  // Initialize stage/step progress rows
  const insertProgress = db.raw.prepare(
    "INSERT INTO stage_progress (id, feature_id, stage, step, status) VALUES (?, ?, ?, ?, 'pending')"
  );

  for (const stage of pipeline.stages) {
    insertProgress.run(generateId(), id, stage.name, STAGE_SENTINEL);
    if (stage.children) {
      for (const child of stage.children) {
        insertProgress.run(generateId(), id, stage.name, child.name);
      }
    }
  }

  return getFeature(db, id)!;
}

export function getFeature(
  db: MissionControlDb,
  id: string
): Feature | null {
  const row = db.raw
    .prepare("SELECT * FROM features WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;

  if (!row) return null;

  const stageProgress = buildStageProgress(db, id);
  const notes = getNotes(db, id);

  const serviceLinks = db.raw
    .prepare("SELECT * FROM feature_services WHERE feature_id = ?")
    .all(id) as ServiceLink[];

  return {
    id: row.id as string,
    title: row.title as string,
    description: (row.description as string) || "",
    pipeline_id: row.pipeline_id as string,
    current_stage: row.current_stage as string,
    status: row.status as Feature["status"],
    weight: (row.weight as number) || 0,
    stage_progress: stageProgress,
    service_links: serviceLinks,
    notes,
    metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export function listFeatures(
  db: MissionControlDb,
  filters: {
    pipeline_id?: string;
    stage?: string;
    status?: string;
  }
): Feature[] {
  let query = "SELECT id FROM features WHERE 1=1";
  const params: string[] = [];

  if (filters.pipeline_id) {
    query += " AND pipeline_id = ?";
    params.push(filters.pipeline_id);
  }
  if (filters.stage) {
    query += " AND current_stage = ?";
    params.push(filters.stage);
  }
  if (filters.status) {
    query += " AND status = ?";
    params.push(filters.status);
  }

  const rows = db.raw.prepare(query).all(...params) as { id: string }[];
  return rows.map((r) => getFeature(db, r.id)!);
}

export function updateFeature(
  db: MissionControlDb,
  id: string,
  fields: {
    weight?: number;
    description?: string;
    metadata?: Record<string, unknown>;
  }
): Feature {
  const existing = getFeature(db, id);
  if (!existing) throw new Error(`Feature not found: ${id}`);

  const updates: string[] = [];
  const params: unknown[] = [];

  if (fields.weight !== undefined) {
    updates.push("weight = ?");
    params.push(fields.weight);
  }
  if (fields.description !== undefined) {
    updates.push("description = ?");
    params.push(fields.description);
  }
  if (fields.metadata !== undefined) {
    updates.push("metadata = ?");
    params.push(JSON.stringify(fields.metadata));
  }

  if (updates.length > 0) {
    updates.push("updated_at = ?");
    params.push(new Date().toISOString());
    params.push(id);
    db.raw
      .prepare(`UPDATE features SET ${updates.join(", ")} WHERE id = ?`)
      .run(...params);
  }

  return getFeature(db, id)!;
}

export function cancelFeature(db: MissionControlDb, id: string): Feature {
  const existing = getFeature(db, id);
  if (!existing) throw new Error(`Feature not found: ${id}`);

  db.raw
    .prepare(
      "UPDATE features SET status = 'cancelled', updated_at = ? WHERE id = ?"
    )
    .run(new Date().toISOString(), id);

  return getFeature(db, id)!;
}

export function advanceFeature(
  db: MissionControlDb,
  featureId: string,
  approved: boolean
): Feature {
  const feature = getFeature(db, featureId);
  if (!feature) throw new Error(`Feature not found: ${featureId}`);
  if (feature.status !== "active") {
    throw new Error(`Feature is not active: ${feature.status}`);
  }

  const pipeline = getPipeline(db, feature.pipeline_id);
  if (!pipeline)
    throw new Error(`Pipeline not found: ${feature.pipeline_id}`);

  const currentStageIndex = pipeline.stages.findIndex(
    (s) => s.name === feature.current_stage
  );
  if (currentStageIndex === -1) {
    throw new Error(`Current stage not found: ${feature.current_stage}`);
  }

  const currentStage = pipeline.stages[currentStageIndex];
  const errors = validateExitConditions(db, feature, currentStage, approved);
  if (errors.length > 0) {
    throw new Error(`Cannot advance: ${errors.join("; ")}`);
  }

  // Mark current stage as completed
  const now = new Date().toISOString();
  db.raw
    .prepare(
      "UPDATE stage_progress SET status = 'completed', completed_at = ? WHERE feature_id = ? AND stage = ? AND step = ?"
    )
    .run(now, featureId, feature.current_stage, STAGE_SENTINEL);

  // If last stage, mark feature as completed
  if (currentStageIndex === pipeline.stages.length - 1) {
    db.raw
      .prepare(
        "UPDATE features SET status = 'completed', updated_at = ? WHERE id = ?"
      )
      .run(now, featureId);
    return getFeature(db, featureId)!;
  }

  // Move to next stage
  const nextStage = pipeline.stages[currentStageIndex + 1].name;
  db.raw
    .prepare(
      "UPDATE features SET current_stage = ?, updated_at = ? WHERE id = ?"
    )
    .run(nextStage, now, featureId);

  return getFeature(db, featureId)!;
}

function validateExitConditions(
  db: MissionControlDb,
  feature: Feature,
  stageNode: Node,
  approved: boolean
): string[] {
  const errors: string[] = [];
  const exit = stageNode.exit_conditions;

  // Check required artifacts
  if (exit.required_artifacts && exit.required_artifacts.length > 0) {
    const stageArtifacts = db.raw
      .prepare(
        "SELECT type FROM artifacts WHERE feature_id = ? AND stage = ?"
      )
      .all(feature.id, feature.current_stage) as { type: string }[];

    const artifactTypes = new Set(stageArtifacts.map((a) => a.type));
    const missing = exit.required_artifacts.filter(
      (t) => !artifactTypes.has(t)
    );
    if (missing.length > 0) {
      errors.push(
        `required_artifacts not met: missing [${missing.join(", ")}]`
      );
    }
  }

  // Check all_children_complete
  if (exit.all_children_complete) {
    const childRows = db.raw
      .prepare(
        "SELECT step, status FROM stage_progress WHERE feature_id = ? AND stage = ? AND step != ?"
      )
      .all(feature.id, feature.current_stage, STAGE_SENTINEL) as {
      step: string;
      status: string;
    }[];

    const incomplete = childRows.filter(
      (r) => r.status !== "completed" && r.status !== "skipped"
    );
    if (incomplete.length > 0) {
      errors.push(
        `all_children_complete not met: [${incomplete.map((r) => r.step).join(", ")}] not complete`
      );
    }
  }

  // Check human approval
  if (exit.human_approval && !approved) {
    errors.push("human_approval required: pass approved=true");
  }

  return errors;
}

export function moveFeature(
  db: MissionControlDb,
  featureId: string,
  targetStage: string,
  reset: boolean
): Feature {
  const feature = getFeature(db, featureId);
  if (!feature) throw new Error(`Feature not found: ${featureId}`);

  const pipeline = getPipeline(db, feature.pipeline_id);
  if (!pipeline)
    throw new Error(`Pipeline not found: ${feature.pipeline_id}`);

  const targetIndex = pipeline.stages.findIndex(
    (s) => s.name === targetStage
  );
  if (targetIndex === -1) {
    throw new Error(
      `Stage '${targetStage}' not found in pipeline '${pipeline.name}'`
    );
  }

  const now = new Date().toISOString();

  if (reset) {
    // Reset target stage and all stages after it
    for (let i = targetIndex; i < pipeline.stages.length; i++) {
      const stageName = pipeline.stages[i].name;
      db.raw
        .prepare(
          "UPDATE stage_progress SET status = 'pending', started_at = NULL, completed_at = NULL WHERE feature_id = ? AND stage = ?"
        )
        .run(featureId, stageName);
    }
  }

  db.raw
    .prepare(
      "UPDATE features SET current_stage = ?, status = 'active', updated_at = ? WHERE id = ?"
    )
    .run(targetStage, now, featureId);

  return getFeature(db, featureId)!;
}

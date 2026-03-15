// mission-control/src/artifacts.ts
import { generateId } from "./utils.js";
import { STAGE_SENTINEL } from "./types.js";
import type { MissionControlDb } from "./db.js";
import type { Artifact, FeatureNote } from "./types.js";

export function addArtifact(
  db: MissionControlDb,
  params: {
    feature_id: string;
    stage: string;
    step?: string;
    type: string;
    content: string;
  }
): Artifact {
  const id = generateId();
  const step = params.step || STAGE_SENTINEL;
  const now = new Date().toISOString();

  db.raw
    .prepare(
      "INSERT INTO artifacts (id, feature_id, stage, step, type, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .run(
      id,
      params.feature_id,
      params.stage,
      step,
      params.type,
      params.content,
      now
    );

  return {
    id,
    feature_id: params.feature_id,
    stage: params.stage,
    step,
    type: params.type,
    content: params.content,
    created_at: now,
  };
}

export function getArtifacts(
  db: MissionControlDb,
  featureId: string,
  stage?: string,
  step?: string
): Artifact[] {
  let query = "SELECT * FROM artifacts WHERE feature_id = ?";
  const params: string[] = [featureId];

  if (stage) {
    query += " AND stage = ?";
    params.push(stage);
  }
  if (step) {
    query += " AND step = ?";
    params.push(step);
  }

  return db.raw.prepare(query).all(...params) as Artifact[];
}

export function addNote(
  db: MissionControlDb,
  params: { feature_id: string; content: string; author: string }
): FeatureNote {
  const id = generateId();
  const now = new Date().toISOString();

  db.raw
    .prepare(
      "INSERT INTO notes (id, feature_id, content, author, created_at) VALUES (?, ?, ?, ?, ?)"
    )
    .run(id, params.feature_id, params.content, params.author, now);

  return {
    id,
    feature_id: params.feature_id,
    content: params.content,
    author: params.author,
    created_at: now,
  };
}

export function getNotes(
  db: MissionControlDb,
  featureId: string
): FeatureNote[] {
  return db.raw
    .prepare("SELECT * FROM notes WHERE feature_id = ? ORDER BY created_at")
    .all(featureId) as FeatureNote[];
}

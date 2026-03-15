// mission-control/src/pipelines.ts
import { parse as parseYaml } from "yaml";
import { generateId } from "./utils.js";
import { STAGE_SENTINEL } from "./types.js";
import type { MissionControlDb } from "./db.js";
import type { Pipeline, Node } from "./types.js";

interface YamlStage {
  name: string;
  executor: string;
  config: Record<string, unknown>;
  exit_conditions?: Record<string, unknown>;
  children?: YamlStage[];
  document?: string;
  metadata?: Record<string, unknown>;
}

interface YamlPipeline {
  name: string;
  stages: YamlStage[];
}

function parseStages(yamlConfig: string): Node[] {
  const parsed: YamlPipeline = parseYaml(yamlConfig);
  if (!parsed?.stages || !Array.isArray(parsed.stages)) {
    throw new Error("Invalid pipeline YAML: missing 'stages' array");
  }
  return parsed.stages.map(parseNode);
}

function parseNode(stage: YamlStage): Node {
  return {
    name: stage.name,
    executor: stage.executor as Node["executor"],
    config: {
      skill: stage.config?.skill as string | undefined,
      command: stage.config?.command as string | undefined,
      description: (stage.config?.description as string) || "",
      agent_instructions: stage.config?.agent_instructions as
        | string
        | undefined,
    },
    exit_conditions: {
      required_artifacts:
        (stage.exit_conditions?.required_artifacts as string[]) || [],
      human_approval:
        (stage.exit_conditions?.human_approval as boolean) ?? false,
      all_children_complete: stage.exit_conditions?.all_children_complete as
        | boolean
        | undefined,
    },
    children: stage.children?.map(parseNode),
    document: stage.document,
    metadata: stage.metadata,
  };
}

function loadDocumentPaths(
  db: MissionControlDb,
  pipelineId: string,
  stages: Node[]
): void {
  const insert = db.raw.prepare(
    "INSERT INTO document_paths (pipeline_id, stage, step, path) VALUES (?, ?, ?, ?)"
  );

  for (const stage of stages) {
    if (stage.document) {
      insert.run(pipelineId, stage.name, STAGE_SENTINEL, stage.document);
    }
    if (stage.children) {
      for (const child of stage.children) {
        if (child.document) {
          insert.run(pipelineId, stage.name, child.name, child.document);
        }
      }
    }
  }
}

export function createPipeline(
  db: MissionControlDb,
  name: string,
  yamlConfig: string
): Pipeline {
  const id = generateId();
  const stages = parseStages(yamlConfig);
  const now = new Date().toISOString();

  db.raw
    .prepare(
      "INSERT INTO pipelines (id, name, config, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    )
    .run(id, name, yamlConfig, now, now);

  loadDocumentPaths(db, id, stages);

  return { id, name, stages, created_at: now, updated_at: now };
}

export function listPipelines(db: MissionControlDb): Pipeline[] {
  const rows = db.raw
    .prepare("SELECT id, name, config, created_at, updated_at FROM pipelines")
    .all() as {
    id: string;
    name: string;
    config: string;
    created_at: string;
    updated_at: string;
  }[];

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    stages: parseStages(row.config),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

export function getPipeline(
  db: MissionControlDb,
  id: string
): Pipeline | null {
  const row = db.raw
    .prepare(
      "SELECT id, name, config, created_at, updated_at FROM pipelines WHERE id = ?"
    )
    .get(id) as
    | {
        id: string;
        name: string;
        config: string;
        created_at: string;
        updated_at: string;
      }
    | undefined;

  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    stages: parseStages(row.config),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

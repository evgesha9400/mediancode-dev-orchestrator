#!/usr/bin/env node
// mission-control/src/index.ts — MCP server entry point
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { createDatabase } from "./db.js";
import { createPipeline, listPipelines, getPipeline } from "./pipelines.js";
import {
  createFeature,
  listFeatures,
  getFeature,
  advanceFeature,
  moveFeature,
  updateFeature,
  cancelFeature,
} from "./features.js";
import { updateStepStatus, getFeatureProgress } from "./progress.js";
import { addArtifact, getArtifacts, addNote, getNotes } from "./artifacts.js";
import {
  registerService,
  listServices,
  linkFeatureService,
  getFeatureServices,
  updateServiceStatus,
} from "./services.js";
import { setDocumentPath, getDocumentPath } from "./documents.js";

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// ---------------------------------------------------------------------------
// Global error wrapper — ALL handlers use this
// ---------------------------------------------------------------------------
function safe<T extends unknown[]>(
  fn: (...args: T) => CallToolResult | Promise<CallToolResult>
): (...args: T) => Promise<CallToolResult> {
  return async (...args: T) => {
    try {
      return await fn(...args);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: [{ type: "text" as const, text: `Error: ${msg}` }],
        isError: true,
      };
    }
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function json(data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
const dbPath = process.env.MISSION_CONTROL_DB || "./db/mission-control.db";
const db = createDatabase(dbPath);

const server = new McpServer({
  name: "mission-control",
  version: "0.1.0",
});

// ===========================================================================
// Pipeline Management
// ===========================================================================

server.tool(
  "create_pipeline",
  "Create a new pipeline from YAML configuration",
  { name: z.string(), yaml_config: z.string() },
  safe((args) => json(createPipeline(db, args.name, args.yaml_config)))
);

server.tool(
  "list_pipelines",
  "List all pipelines",
  safe(() => json(listPipelines(db)))
);

server.tool(
  "get_pipeline",
  "Get a pipeline by ID",
  { id: z.string() },
  safe((args) => json(getPipeline(db, args.id)))
);

// ===========================================================================
// Feature Lifecycle
// ===========================================================================

server.tool(
  "create_feature",
  "Create a new feature in a pipeline",
  {
    title: z.string(),
    description: z.string(),
    pipeline_id: z.string(),
    metadata: z.record(z.unknown()).optional(),
  },
  safe((args) =>
    json(
      createFeature(db, {
        title: args.title,
        description: args.description,
        pipeline_id: args.pipeline_id,
        metadata: args.metadata,
      })
    )
  )
);

server.tool(
  "list_features",
  "List features with optional filters",
  {
    pipeline_id: z.string().optional(),
    stage: z.string().optional(),
    status: z.string().optional(),
  },
  safe((args) =>
    json(
      listFeatures(db, {
        pipeline_id: args.pipeline_id,
        stage: args.stage,
        status: args.status,
      })
    )
  )
);

server.tool(
  "get_feature",
  "Get a feature by ID",
  { id: z.string() },
  safe((args) => json(getFeature(db, args.id)))
);

server.tool(
  "advance_feature",
  "Advance a feature to the next pipeline stage",
  { id: z.string(), approved: z.boolean().default(false) },
  safe((args) => json(advanceFeature(db, args.id, args.approved)))
);

server.tool(
  "move_feature",
  "Move a feature to a specific stage",
  {
    id: z.string(),
    target_stage: z.string(),
    reset: z.boolean().default(true),
  },
  safe((args) => json(moveFeature(db, args.id, args.target_stage, args.reset)))
);

server.tool(
  "update_feature",
  "Update feature fields (weight, description, metadata)",
  {
    id: z.string(),
    weight: z.number().optional(),
    description: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
  },
  safe((args) =>
    json(
      updateFeature(db, args.id, {
        weight: args.weight,
        description: args.description,
        metadata: args.metadata,
      })
    )
  )
);

server.tool(
  "cancel_feature",
  "Cancel a feature",
  { id: z.string() },
  safe((args) => json(cancelFeature(db, args.id)))
);

// ===========================================================================
// Stage & Step Tracking
// ===========================================================================

server.tool(
  "update_step_status",
  "Update the status of a stage or step",
  {
    feature_id: z.string(),
    stage: z.string(),
    step: z.string().optional(),
    status: z.enum(["pending", "in_progress", "completed", "skipped"]),
  },
  safe((args) => {
    updateStepStatus(db, args.feature_id, args.stage, args.step, args.status);
    return json({ ok: true });
  })
);

server.tool(
  "get_feature_progress",
  "Get full progress breakdown for a feature",
  { feature_id: z.string() },
  safe((args) => json(getFeatureProgress(db, args.feature_id)))
);

// ===========================================================================
// Artifacts & Notes
// ===========================================================================

server.tool(
  "add_artifact",
  "Add an artifact to a feature stage or step",
  {
    feature_id: z.string(),
    stage: z.string(),
    step: z.string().optional(),
    type: z.string(),
    content: z.string(),
  },
  safe((args) =>
    json(
      addArtifact(db, {
        feature_id: args.feature_id,
        stage: args.stage,
        step: args.step,
        type: args.type,
        content: args.content,
      })
    )
  )
);

server.tool(
  "get_artifacts",
  "Get artifacts for a feature, optionally filtered by stage/step",
  {
    feature_id: z.string(),
    stage: z.string().optional(),
    step: z.string().optional(),
  },
  safe((args) => json(getArtifacts(db, args.feature_id, args.stage, args.step)))
);

server.tool(
  "add_note",
  "Add a note to a feature",
  {
    feature_id: z.string(),
    content: z.string(),
    author: z.string(),
  },
  safe((args) =>
    json(
      addNote(db, {
        feature_id: args.feature_id,
        content: args.content,
        author: args.author,
      })
    )
  )
);

server.tool(
  "get_notes",
  "Get all notes for a feature",
  { feature_id: z.string() },
  safe((args) => json(getNotes(db, args.feature_id)))
);

// ===========================================================================
// Service Registry
// ===========================================================================

server.tool(
  "register_service",
  "Register a service in the registry",
  {
    name: z.string(),
    path: z.string(),
    stack: z.string(),
    metadata: z.record(z.unknown()).optional(),
  },
  safe((args) =>
    json(
      registerService(db, {
        name: args.name,
        path: args.path,
        stack: args.stack,
        metadata: args.metadata,
      })
    )
  )
);

server.tool(
  "list_services",
  "List all registered services",
  safe(() => json(listServices(db)))
);

server.tool(
  "link_feature_service",
  "Link a feature to a service",
  { feature_id: z.string(), service_name: z.string() },
  safe((args) => {
    linkFeatureService(db, args.feature_id, args.service_name);
    return json({ ok: true });
  })
);

server.tool(
  "get_feature_services",
  "Get services linked to a feature",
  { feature_id: z.string() },
  safe((args) => json(getFeatureServices(db, args.feature_id)))
);

server.tool(
  "update_service_status",
  "Update the status of a feature-service link",
  {
    feature_id: z.string(),
    service_name: z.string(),
    status: z.enum(["pending", "in_progress", "completed"]),
  },
  safe((args) =>
    json(
      (() => {
        updateServiceStatus(
          db,
          args.feature_id,
          args.service_name,
          args.status
        );
        return { ok: true };
      })()
    )
  )
);

// ===========================================================================
// Document Pointers
// ===========================================================================

server.tool(
  "set_document_path",
  "Set a document path for a pipeline stage or step",
  {
    pipeline_id: z.string(),
    stage: z.string(),
    step: z.string().optional(),
    path: z.string(),
  },
  safe((args) => {
    setDocumentPath(db, args.pipeline_id, args.stage, args.step, args.path);
    return json({ ok: true });
  })
);

server.tool(
  "get_document_path",
  "Get the document path for a pipeline stage or step",
  {
    pipeline_id: z.string(),
    stage: z.string(),
    step: z.string().optional(),
  },
  safe((args) =>
    json({
      path: getDocumentPath(db, args.pipeline_id, args.stage, args.step),
    })
  )
);

// ===========================================================================
// Start server
// ===========================================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

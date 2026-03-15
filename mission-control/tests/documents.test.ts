import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDatabase, type MissionControlDb } from "../src/db.js";
import { createPipeline } from "../src/pipelines.js";
import { setDocumentPath, getDocumentPath } from "../src/documents.js";

const PIPELINE_YAML = `
name: Test
stages:
  - name: Design
    executor: agent
    config:
      description: Design
    exit_conditions:
      human_approval: false
    document: docs/design.md
`;

describe("Documents", () => {
  let db: MissionControlDb;
  let pipelineId: string;
  beforeEach(() => {
    db = createDatabase(":memory:");
    const pipeline = createPipeline(db, "Test", PIPELINE_YAML);
    pipelineId = pipeline.id;
  });
  afterEach(() => {
    db.close();
  });

  it("gets document path auto-loaded from YAML", () => {
    expect(getDocumentPath(db, pipelineId, "Design")).toBe("docs/design.md");
  });

  it("overrides document path at runtime", () => {
    setDocumentPath(db, pipelineId, "Design", undefined, "docs/new-design.md");
    expect(getDocumentPath(db, pipelineId, "Design")).toBe(
      "docs/new-design.md"
    );
  });

  it("returns null for nonexistent document path", () => {
    expect(getDocumentPath(db, pipelineId, "Nonexistent")).toBeNull();
  });
});

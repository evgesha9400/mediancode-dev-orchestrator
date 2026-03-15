// mission-control/tests/artifacts.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDatabase, type MissionControlDb } from "../src/db.js";
import { createPipeline } from "../src/pipelines.js";
import { createFeature } from "../src/features.js";
import { addArtifact, getArtifacts, addNote, getNotes } from "../src/artifacts.js";

const PIPELINE_YAML = `
name: Test
stages:
  - name: Design
    executor: agent
    config:
      description: Design
    exit_conditions:
      human_approval: false
`;

describe("Artifacts", () => {
  let db: MissionControlDb;
  let featureId: string;

  beforeEach(() => {
    db = createDatabase(":memory:");
    const pipeline = createPipeline(db, "Test", PIPELINE_YAML);
    const feature = createFeature(db, {
      title: "F",
      description: "",
      pipeline_id: pipeline.id,
    });
    featureId = feature.id;
  });

  afterEach(() => {
    db.close();
  });

  it("adds and retrieves artifacts", () => {
    addArtifact(db, {
      feature_id: featureId,
      stage: "Design",
      type: "design-spec",
      content: "/path/to/spec.md",
    });

    const artifacts = getArtifacts(db, featureId);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].type).toBe("design-spec");
  });

  it("filters artifacts by stage", () => {
    addArtifact(db, {
      feature_id: featureId,
      stage: "Design",
      type: "spec",
      content: "a",
    });

    expect(getArtifacts(db, featureId, "Design")).toHaveLength(1);
    expect(getArtifacts(db, featureId, "Nonexistent")).toHaveLength(0);
  });
});

describe("Notes", () => {
  let db: MissionControlDb;
  let featureId: string;

  beforeEach(() => {
    db = createDatabase(":memory:");
    const pipeline = createPipeline(db, "Test", PIPELINE_YAML);
    const feature = createFeature(db, {
      title: "F",
      description: "",
      pipeline_id: pipeline.id,
    });
    featureId = feature.id;
  });

  afterEach(() => {
    db.close();
  });

  it("adds and retrieves notes", () => {
    addNote(db, {
      feature_id: featureId,
      content: "Schema changed to UUID",
      author: "backend-agent",
    });

    const notes = getNotes(db, featureId);
    expect(notes).toHaveLength(1);
    expect(notes[0].author).toBe("backend-agent");
  });
});

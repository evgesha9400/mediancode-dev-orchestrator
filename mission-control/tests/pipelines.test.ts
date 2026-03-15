// mission-control/tests/pipelines.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDatabase, type MissionControlDb } from "../src/db.js";
import {
  createPipeline,
  listPipelines,
  getPipeline,
} from "../src/pipelines.js";

const SAMPLE_YAML = `
name: Test Pipeline
stages:
  - name: Design
    executor: agent
    config:
      skill: brainstorming
      description: Create design spec
    exit_conditions:
      required_artifacts: [design-spec]
      human_approval: true
    document: docs/stages/design.md
  - name: Implement
    executor: agent
    config:
      skill: executing-plans
      description: Write code
    exit_conditions:
      required_artifacts: [implementation-commit]
      human_approval: false
    document: docs/stages/implement.md
    children:
      - name: Write Tests
        executor: agent
        config:
          skill: tdd
          description: Write failing tests
        exit_conditions:
          required_artifacts: [test-files]
          human_approval: false
        document: docs/stages/implement/write-tests.md
      - name: Write Code
        executor: agent
        config:
          skill: coding
          description: Make tests pass
        exit_conditions:
          required_artifacts: [code-commit]
          human_approval: false
        document: docs/stages/implement/write-code.md
`;

describe("Pipelines", () => {
  let db: MissionControlDb;

  beforeEach(() => {
    db = createDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("creates a pipeline from YAML and auto-loads document paths", () => {
    const pipeline = createPipeline(db, "Test Pipeline", SAMPLE_YAML);

    expect(pipeline.id).toBeDefined();
    expect(pipeline.name).toBe("Test Pipeline");
    expect(pipeline.stages).toHaveLength(2);
    expect(pipeline.stages[0].name).toBe("Design");
    expect(pipeline.stages[1].name).toBe("Implement");
    expect(pipeline.stages[1].children).toHaveLength(2);

    // Verify document paths were auto-loaded
    const docPath = db.raw
      .prepare(
        "SELECT path FROM document_paths WHERE pipeline_id = ? AND stage = ? AND step = '__stage__'"
      )
      .get(pipeline.id, "Design") as { path: string } | undefined;
    expect(docPath?.path).toBe("docs/stages/design.md");

    // Verify child document paths
    const stepDocPath = db.raw
      .prepare(
        "SELECT path FROM document_paths WHERE pipeline_id = ? AND stage = ? AND step = ?"
      )
      .get(pipeline.id, "Implement", "Write Tests") as
      | { path: string }
      | undefined;
    expect(stepDocPath?.path).toBe("docs/stages/implement/write-tests.md");
  });

  it("rejects duplicate pipeline names", () => {
    createPipeline(db, "Test Pipeline", SAMPLE_YAML);
    expect(() => createPipeline(db, "Test Pipeline", SAMPLE_YAML)).toThrow();
  });

  it("lists all pipelines", () => {
    createPipeline(db, "Pipeline A", SAMPLE_YAML);
    createPipeline(db, "Pipeline B", SAMPLE_YAML);
    const pipelines = listPipelines(db);
    expect(pipelines).toHaveLength(2);
  });

  it("gets a pipeline by ID with parsed stages", () => {
    const created = createPipeline(db, "Test Pipeline", SAMPLE_YAML);
    const fetched = getPipeline(db, created.id);

    expect(fetched).not.toBeNull();
    expect(fetched!.name).toBe("Test Pipeline");
    expect(fetched!.stages).toHaveLength(2);
    expect(fetched!.stages[1].children).toHaveLength(2);
  });

  it("returns null for nonexistent pipeline", () => {
    expect(getPipeline(db, "nonexistent")).toBeNull();
  });
});

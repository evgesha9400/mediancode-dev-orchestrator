// mission-control/tests/integration.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDatabase, type MissionControlDb } from "../src/db.js";
import { createPipeline, getPipeline } from "../src/pipelines.js";
import {
  createFeature,
  getFeature,
  listFeatures,
  updateFeature,
  advanceFeature,
  moveFeature,
  cancelFeature,
} from "../src/features.js";
import { addArtifact, getArtifacts, addNote, getNotes } from "../src/artifacts.js";
import { updateStepStatus, getFeatureProgress } from "../src/progress.js";
import {
  registerService,
  linkFeatureService,
  getFeatureServices,
  updateServiceStatus,
} from "../src/services.js";
import { getDocumentPath } from "../src/documents.js";

const FULL_PIPELINE_YAML = `
name: Software Development
stages:
  - name: Design
    executor: agent
    config:
      skill: brainstorming
      description: Design phase
    exit_conditions:
      required_artifacts: [design-spec]
      human_approval: true
    document: docs/stages/design.md
  - name: Implement
    executor: agent
    config:
      description: Implementation phase
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
    exit_conditions:
      all_children_complete: true
      human_approval: false
  - name: Test
    executor: agent
    config:
      skill: testing
      description: Run all tests
    exit_conditions:
      required_artifacts: [test-report]
      human_approval: false
    document: docs/stages/test.md
  - name: Review
    executor: agent
    config:
      skill: review
      description: Code review
    exit_conditions:
      required_artifacts: [review-report]
      human_approval: true
    document: docs/stages/review.md
  - name: Release
    executor: human
    config:
      description: Deploy
    exit_conditions:
      required_artifacts: [release-url]
      human_approval: true
    document: docs/stages/release.md
`;

describe("Integration: Full Pipeline Flow", () => {
  let db: MissionControlDb;

  beforeEach(() => {
    db = createDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("advances a feature through the complete pipeline lifecycle", () => {
    // 1. Create pipeline
    const pipeline = createPipeline(db, "Software Development", FULL_PIPELINE_YAML);
    expect(pipeline.stages).toHaveLength(5);

    // 2. Register services
    registerService(db, { name: "frontend", path: "/path/frontend", stack: "svelte" });
    registerService(db, { name: "backend", path: "/path/backend", stack: "python" });

    // 3. Create feature
    const feature = createFeature(db, {
      title: "Add Relationships",
      description: "Support entity relationships",
      pipeline_id: pipeline.id,
    });
    expect(feature.current_stage).toBe("Design");
    expect(feature.stage_progress).toHaveLength(5);

    // 4. Link services
    linkFeatureService(db, feature.id, "frontend");
    linkFeatureService(db, feature.id, "backend");
    expect(getFeatureServices(db, feature.id)).toHaveLength(2);

    // 5. Add a cross-cutting note
    addNote(db, {
      feature_id: feature.id,
      content: "Backend needs cascade delete support",
      author: "human",
    });

    // 6. Complete Design stage
    addArtifact(db, {
      feature_id: feature.id,
      stage: "Design",
      type: "design-spec",
      content: "docs/specs/relationships.md",
    });
    const afterDesign = advanceFeature(db, feature.id, true);
    expect(afterDesign.current_stage).toBe("Implement");

    // 7. Complete Implement stage (all children)
    updateStepStatus(db, feature.id, "Implement", "Write Tests", "in_progress");
    updateStepStatus(db, feature.id, "Implement", "Write Tests", "completed");
    addArtifact(db, {
      feature_id: feature.id,
      stage: "Implement",
      step: "Write Tests",
      type: "test-files",
      content: "tests/relationships/",
    });

    updateStepStatus(db, feature.id, "Implement", "Write Code", "in_progress");
    updateStepStatus(db, feature.id, "Implement", "Write Code", "completed");
    addArtifact(db, {
      feature_id: feature.id,
      stage: "Implement",
      step: "Write Code",
      type: "code-commit",
      content: "abc123",
    });

    updateServiceStatus(db, feature.id, "backend", "completed");
    updateServiceStatus(db, feature.id, "frontend", "completed");

    const afterImpl = advanceFeature(db, feature.id, false);
    expect(afterImpl.current_stage).toBe("Test");

    // 8. Complete Test stage
    addArtifact(db, {
      feature_id: feature.id,
      stage: "Test",
      type: "test-report",
      content: "All 47 tests pass",
    });
    const afterTest = advanceFeature(db, feature.id, false);
    expect(afterTest.current_stage).toBe("Review");

    // 9. Complete Review stage
    addArtifact(db, {
      feature_id: feature.id,
      stage: "Review",
      type: "review-report",
      content: "LGTM — approved",
    });
    const afterReview = advanceFeature(db, feature.id, true);
    expect(afterReview.current_stage).toBe("Release");

    // 10. Complete Release stage (final)
    addArtifact(db, {
      feature_id: feature.id,
      stage: "Release",
      type: "release-url",
      content: "https://app.mediancode.com",
    });
    const completed = advanceFeature(db, feature.id, true);
    expect(completed.status).toBe("completed");

    // 11. Verify final state
    const final = getFeature(db, feature.id)!;
    expect(final.status).toBe("completed");
    expect(final.notes).toHaveLength(1);
    expect(getArtifacts(db, feature.id)).toHaveLength(6);
    expect(getFeatureServices(db, feature.id).every((s) => s.status === "completed")).toBe(true);

    // 12. Verify document paths from YAML
    expect(getDocumentPath(db, pipeline.id, "Design")).toBe("docs/stages/design.md");
    expect(getDocumentPath(db, pipeline.id, "Implement", "Write Tests")).toBe(
      "docs/stages/implement/write-tests.md"
    );
  });

  it("handles concurrent features at different stages", () => {
    const pipeline = createPipeline(db, "SD", FULL_PIPELINE_YAML);

    const f1 = createFeature(db, { title: "F1", description: "", pipeline_id: pipeline.id });
    const f2 = createFeature(db, { title: "F2", description: "", pipeline_id: pipeline.id });
    const f3 = createFeature(db, { title: "F3", description: "", pipeline_id: pipeline.id });

    // Advance F1 to Implement
    addArtifact(db, { feature_id: f1.id, stage: "Design", type: "design-spec", content: "x" });
    advanceFeature(db, f1.id, true);

    // Leave F2 in Design, advance F3 to Implement
    addArtifact(db, { feature_id: f3.id, stage: "Design", type: "design-spec", content: "x" });
    advanceFeature(db, f3.id, true);

    // Verify all three are at different points
    const features = listFeatures(db, {});
    const stages = features.map((f) => f.current_stage);
    expect(stages).toContain("Design");
    expect(stages.filter((s) => s === "Implement")).toHaveLength(2);
  });

  it("handles move backward with reset correctly", () => {
    const pipeline = createPipeline(db, "SD", FULL_PIPELINE_YAML);
    const feature = createFeature(db, { title: "F", description: "", pipeline_id: pipeline.id });

    // Advance to Implement
    addArtifact(db, { feature_id: feature.id, stage: "Design", type: "design-spec", content: "x" });
    advanceFeature(db, feature.id, true);

    // Complete some steps
    updateStepStatus(db, feature.id, "Implement", "Write Tests", "completed");

    // Move back to Design with reset
    moveFeature(db, feature.id, "Design", true);
    const moved = getFeature(db, feature.id)!;

    expect(moved.current_stage).toBe("Design");
    expect(moved.stage_progress[0].status).toBe("pending"); // Design reset
    expect(moved.stage_progress[1].step_progress![0].status).toBe("pending"); // Write Tests reset
  });
});

describe("Guardrails", () => {
  let db: MissionControlDb;

  beforeEach(() => {
    db = createDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("rejects creating a feature for nonexistent pipeline", () => {
    expect(() =>
      createFeature(db, { title: "F", description: "", pipeline_id: "nonexistent" })
    ).toThrow(/Pipeline not found/);
  });

  it("rejects advancing a cancelled feature", () => {
    const pipeline = createPipeline(db, "SD", FULL_PIPELINE_YAML);
    const feature = createFeature(db, { title: "F", description: "", pipeline_id: pipeline.id });
    cancelFeature(db, feature.id);

    expect(() => advanceFeature(db, feature.id, false)).toThrow(/not active/);
  });

  it("rejects moving to nonexistent stage", () => {
    const pipeline = createPipeline(db, "SD", FULL_PIPELINE_YAML);
    const feature = createFeature(db, { title: "F", description: "", pipeline_id: pipeline.id });

    expect(() => moveFeature(db, feature.id, "Nonexistent", true)).toThrow(
      /not found in pipeline/
    );
  });

  it("rejects updating nonexistent feature", () => {
    expect(() => updateFeature(db, "nonexistent", { weight: 5 })).toThrow(
      /Feature not found/
    );
  });

  it("rejects updating nonexistent step status", () => {
    const pipeline = createPipeline(db, "SD", FULL_PIPELINE_YAML);
    const feature = createFeature(db, { title: "F", description: "", pipeline_id: pipeline.id });

    expect(() =>
      updateStepStatus(db, feature.id, "Nonexistent", undefined, "in_progress")
    ).toThrow();
  });

  it("rejects duplicate service registration", () => {
    registerService(db, { name: "frontend", path: "/a", stack: "svelte" });
    expect(() =>
      registerService(db, { name: "frontend", path: "/b", stack: "svelte" })
    ).toThrow();
  });

  it("rejects updating nonexistent service link", () => {
    expect(() =>
      updateServiceStatus(db, "nonexistent", "nonexistent", "completed")
    ).toThrow(/Service link not found/);
  });

  it("rejects invalid YAML for pipeline creation", () => {
    expect(() => createPipeline(db, "Bad", "not: valid: yaml: [")).toThrow();
  });

  it("rejects YAML without stages array", () => {
    expect(() => createPipeline(db, "Bad", "name: No Stages")).toThrow(
      /missing 'stages' array/
    );
  });

  it("preserves idempotency — creating same artifact twice is safe", () => {
    const pipeline = createPipeline(db, "SD", FULL_PIPELINE_YAML);
    const feature = createFeature(db, { title: "F", description: "", pipeline_id: pipeline.id });

    addArtifact(db, { feature_id: feature.id, stage: "Design", type: "spec", content: "v1" });
    addArtifact(db, { feature_id: feature.id, stage: "Design", type: "spec", content: "v2" });

    const artifacts = getArtifacts(db, feature.id, "Design");
    expect(artifacts).toHaveLength(2); // Both kept as historical records
  });
});

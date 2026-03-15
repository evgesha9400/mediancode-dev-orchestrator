// mission-control/tests/progress.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDatabase, type MissionControlDb } from "../src/db.js";
import { createPipeline } from "../src/pipelines.js";
import { createFeature } from "../src/features.js";
import { updateStepStatus, getFeatureProgress } from "../src/progress.js";

const PIPELINE_YAML = `
name: Test
stages:
  - name: Design
    executor: agent
    config:
      description: Design
    exit_conditions:
      human_approval: false
  - name: Implement
    executor: agent
    config:
      description: Implement
    children:
      - name: Write Tests
        executor: agent
        config:
          description: Write tests
        exit_conditions:
          human_approval: false
      - name: Write Code
        executor: agent
        config:
          description: Write code
        exit_conditions:
          human_approval: false
    exit_conditions:
      all_children_complete: true
      human_approval: false
`;

describe("Progress", () => {
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

  it("updates stage-level status", () => {
    updateStepStatus(db, featureId, "Design", undefined, "in_progress");
    const progress = getFeatureProgress(db, featureId);
    expect(progress[0].status).toBe("in_progress");
    expect(progress[0].started_at).toBeDefined();
  });

  it("updates step-level status", () => {
    updateStepStatus(db, featureId, "Implement", "Write Tests", "completed");
    const progress = getFeatureProgress(db, featureId);
    const impl = progress.find((p) => p.stage === "Implement");
    expect(impl?.step_progress?.[0].status).toBe("completed");
  });

  it("throws for nonexistent progress row", () => {
    expect(() =>
      updateStepStatus(db, featureId, "Nonexistent", undefined, "in_progress")
    ).toThrow();
  });

  it("returns full 2D progress view", () => {
    const progress = getFeatureProgress(db, featureId);
    expect(progress).toHaveLength(2);
    expect(progress[1].step_progress).toHaveLength(2);
  });
});

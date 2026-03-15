// mission-control/tests/features.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDatabase, type MissionControlDb } from "../src/db.js";
import { createPipeline } from "../src/pipelines.js";
import {
  createFeature,
  getFeature,
  listFeatures,
  updateFeature,
  cancelFeature,
  advanceFeature,
  moveFeature,
} from "../src/features.js";
import { addArtifact } from "../src/artifacts.js";
import { updateStepStatus } from "../src/progress.js";

const PIPELINE_YAML = `
name: Test Pipeline
stages:
  - name: Design
    executor: agent
    config:
      description: Design phase
    exit_conditions:
      required_artifacts: [design-spec]
      human_approval: true
    document: docs/design.md
  - name: Implement
    executor: agent
    config:
      description: Implement phase
    document: docs/implement.md
    children:
      - name: Write Tests
        executor: agent
        config:
          description: Write tests
        exit_conditions:
          required_artifacts: [test-files]
          human_approval: false
        document: docs/implement/write-tests.md
      - name: Write Code
        executor: agent
        config:
          description: Write code
        exit_conditions:
          required_artifacts: [code-commit]
          human_approval: false
        document: docs/implement/write-code.md
    exit_conditions:
      all_children_complete: true
      human_approval: false
  - name: Release
    executor: human
    config:
      description: Release
    exit_conditions:
      human_approval: true
`;

describe("Features", () => {
  let db: MissionControlDb;
  let pipelineId: string;

  beforeEach(() => {
    db = createDatabase(":memory:");
    const pipeline = createPipeline(db, "Test Pipeline", PIPELINE_YAML);
    pipelineId = pipeline.id;
  });

  afterEach(() => {
    db.close();
  });

  describe("create", () => {
    it("creates a feature with stage progress initialized", () => {
      const feature = createFeature(db, {
        title: "Add Relationships",
        description: "Add relationship support",
        pipeline_id: pipelineId,
      });

      expect(feature.id).toBeDefined();
      expect(feature.title).toBe("Add Relationships");
      expect(feature.current_stage).toBe("Design");
      expect(feature.status).toBe("active");
      expect(feature.stage_progress).toHaveLength(3);
      expect(feature.stage_progress[0].stage).toBe("Design");
      expect(feature.stage_progress[0].status).toBe("pending");
      expect(feature.stage_progress[1].stage).toBe("Implement");
      expect(feature.stage_progress[1].step_progress).toHaveLength(2);
      expect(feature.stage_progress[1].step_progress![0].step).toBe(
        "Write Tests"
      );
    });
  });

  describe("list and get", () => {
    it("lists features with optional filters", () => {
      createFeature(db, {
        title: "F1",
        description: "",
        pipeline_id: pipelineId,
      });
      createFeature(db, {
        title: "F2",
        description: "",
        pipeline_id: pipelineId,
      });

      expect(listFeatures(db, {})).toHaveLength(2);
      expect(listFeatures(db, { pipeline_id: pipelineId })).toHaveLength(2);
      expect(listFeatures(db, { pipeline_id: "nonexistent" })).toHaveLength(0);
      expect(listFeatures(db, { status: "active" })).toHaveLength(2);
    });

    it("gets a feature with full nested progress", () => {
      const created = createFeature(db, {
        title: "Test Feature",
        description: "Desc",
        pipeline_id: pipelineId,
      });

      const fetched = getFeature(db, created.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.stage_progress).toHaveLength(3);
      expect(fetched!.stage_progress[1].step_progress).toHaveLength(2);
    });

    it("returns null for nonexistent feature", () => {
      expect(getFeature(db, "nonexistent")).toBeNull();
    });
  });

  describe("update and cancel", () => {
    it("updates feature fields", () => {
      const feature = createFeature(db, {
        title: "Original",
        description: "",
        pipeline_id: pipelineId,
      });

      const updated = updateFeature(db, feature.id, {
        weight: 5,
        description: "Updated desc",
      });

      expect(updated.weight).toBe(5);
      expect(updated.description).toBe("Updated desc");
    });

    it("cancels a feature", () => {
      const feature = createFeature(db, {
        title: "To Cancel",
        description: "",
        pipeline_id: pipelineId,
      });

      const cancelled = cancelFeature(db, feature.id);
      expect(cancelled.status).toBe("cancelled");
    });
  });

  describe("advance_feature", () => {
    it("fails without required artifacts", () => {
      const feature = createFeature(db, {
        title: "F",
        description: "",
        pipeline_id: pipelineId,
      });

      expect(() => advanceFeature(db, feature.id, false)).toThrow(
        /required_artifacts.*design-spec/
      );
    });

    it("fails without human approval when required", () => {
      const feature = createFeature(db, {
        title: "F",
        description: "",
        pipeline_id: pipelineId,
      });

      addArtifact(db, {
        feature_id: feature.id,
        stage: "Design",
        type: "design-spec",
        content: "spec.md",
      });

      expect(() => advanceFeature(db, feature.id, false)).toThrow(
        /human_approval/
      );
    });

    it("advances when all conditions met", () => {
      const feature = createFeature(db, {
        title: "F",
        description: "",
        pipeline_id: pipelineId,
      });

      addArtifact(db, {
        feature_id: feature.id,
        stage: "Design",
        type: "design-spec",
        content: "spec.md",
      });

      const advanced = advanceFeature(db, feature.id, true);
      expect(advanced.current_stage).toBe("Implement");
    });

    it("fails to advance stage with all_children_complete when steps incomplete", () => {
      const feature = createFeature(db, {
        title: "F",
        description: "",
        pipeline_id: pipelineId,
      });

      // Advance past Design
      addArtifact(db, {
        feature_id: feature.id,
        stage: "Design",
        type: "design-spec",
        content: "spec.md",
      });
      advanceFeature(db, feature.id, true);

      // Try to advance Implement without completing steps
      expect(() => advanceFeature(db, feature.id, false)).toThrow(
        /all_children_complete/
      );
    });

    it("advances stage with all_children_complete when all steps done", () => {
      const feature = createFeature(db, {
        title: "F",
        description: "",
        pipeline_id: pipelineId,
      });

      // Advance past Design
      addArtifact(db, {
        feature_id: feature.id,
        stage: "Design",
        type: "design-spec",
        content: "spec.md",
      });
      advanceFeature(db, feature.id, true);

      // Complete all steps in Implement
      updateStepStatus(db, feature.id, "Implement", "Write Tests", "completed");
      addArtifact(db, {
        feature_id: feature.id,
        stage: "Implement",
        step: "Write Tests",
        type: "test-files",
        content: "tests/",
      });

      updateStepStatus(db, feature.id, "Implement", "Write Code", "completed");
      addArtifact(db, {
        feature_id: feature.id,
        stage: "Implement",
        step: "Write Code",
        type: "code-commit",
        content: "abc123",
      });

      const advanced = advanceFeature(db, feature.id, false);
      expect(advanced.current_stage).toBe("Release");
    });

    it("throws when trying to advance past last stage", () => {
      const feature = createFeature(db, {
        title: "F",
        description: "",
        pipeline_id: pipelineId,
      });

      // Advance Design -> Implement
      addArtifact(db, {
        feature_id: feature.id,
        stage: "Design",
        type: "design-spec",
        content: "x",
      });
      advanceFeature(db, feature.id, true);

      // Advance Implement -> Release
      updateStepStatus(db, feature.id, "Implement", "Write Tests", "completed");
      addArtifact(db, {
        feature_id: feature.id,
        stage: "Implement",
        step: "Write Tests",
        type: "test-files",
        content: "x",
      });
      updateStepStatus(db, feature.id, "Implement", "Write Code", "completed");
      addArtifact(db, {
        feature_id: feature.id,
        stage: "Implement",
        step: "Write Code",
        type: "code-commit",
        content: "x",
      });
      advanceFeature(db, feature.id, false);

      // Advance Release (complete the feature)
      const completed = advanceFeature(db, feature.id, true);
      expect(completed.status).toBe("completed");
    });
  });

  describe("move_feature", () => {
    it("moves backward with reset", () => {
      const feature = createFeature(db, {
        title: "F",
        description: "",
        pipeline_id: pipelineId,
      });

      // Advance to Implement
      addArtifact(db, {
        feature_id: feature.id,
        stage: "Design",
        type: "design-spec",
        content: "x",
      });
      advanceFeature(db, feature.id, true);

      // Move back to Design with reset
      const moved = moveFeature(db, feature.id, "Design", true);
      expect(moved.current_stage).toBe("Design");

      const progress = getFeature(db, feature.id)!;
      expect(progress.stage_progress[0].status).toBe("pending");
    });

    it("moves forward without reset", () => {
      const feature = createFeature(db, {
        title: "F",
        description: "",
        pipeline_id: pipelineId,
      });

      const moved = moveFeature(db, feature.id, "Release", false);
      expect(moved.current_stage).toBe("Release");
    });

    it("throws for nonexistent stage", () => {
      const feature = createFeature(db, {
        title: "F",
        description: "",
        pipeline_id: pipelineId,
      });

      expect(() => moveFeature(db, feature.id, "Nonexistent", true)).toThrow(
        /not found in pipeline/
      );
    });
  });
});

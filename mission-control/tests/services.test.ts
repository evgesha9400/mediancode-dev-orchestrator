import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDatabase, type MissionControlDb } from "../src/db.js";
import { createPipeline } from "../src/pipelines.js";
import { createFeature } from "../src/features.js";
import {
  registerService,
  listServices,
  linkFeatureService,
  getFeatureServices,
  updateServiceStatus,
} from "../src/services.js";

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

describe("Services", () => {
  let db: MissionControlDb;
  beforeEach(() => {
    db = createDatabase(":memory:");
  });
  afterEach(() => {
    db.close();
  });

  it("registers and lists services", () => {
    registerService(db, {
      name: "frontend",
      path: "/path/to/frontend",
      stack: "svelte/typescript",
    });
    registerService(db, {
      name: "backend",
      path: "/path/to/backend",
      stack: "python/fastapi",
    });
    expect(listServices(db)).toHaveLength(2);
  });

  it("rejects duplicate service names", () => {
    registerService(db, { name: "frontend", path: "/a", stack: "svelte" });
    expect(() =>
      registerService(db, { name: "frontend", path: "/b", stack: "svelte" })
    ).toThrow();
  });

  it("links services to features and tracks status", () => {
    const pipeline = createPipeline(db, "Test", PIPELINE_YAML);
    const feature = createFeature(db, {
      title: "F",
      description: "",
      pipeline_id: pipeline.id,
    });
    registerService(db, { name: "frontend", path: "/a", stack: "svelte" });
    registerService(db, { name: "backend", path: "/b", stack: "python" });
    linkFeatureService(db, feature.id, "frontend");
    linkFeatureService(db, feature.id, "backend");

    const links = getFeatureServices(db, feature.id);
    expect(links).toHaveLength(2);
    expect(links[0].status).toBe("pending");

    updateServiceStatus(db, feature.id, "backend", "completed");
    const updated = getFeatureServices(db, feature.id);
    const backend = updated.find((l) => l.service_name === "backend");
    expect(backend?.status).toBe("completed");
  });
});

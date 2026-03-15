// mission-control/tests/db.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDatabase, type MissionControlDb } from "../src/db.js";
import Database from "better-sqlite3";

describe("Database", () => {
  let db: MissionControlDb;

  beforeEach(() => {
    db = createDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("creates all tables", () => {
    const tables = db.raw
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);

    expect(names).toContain("pipelines");
    expect(names).toContain("features");
    expect(names).toContain("stage_progress");
    expect(names).toContain("artifacts");
    expect(names).toContain("notes");
    expect(names).toContain("services");
    expect(names).toContain("feature_services");
    expect(names).toContain("document_paths");
  });

  it("enforces foreign key constraints", () => {
    expect(() => {
      db.raw
        .prepare(
          "INSERT INTO features (id, title, pipeline_id, current_stage, status) VALUES ('f1', 'Test', 'nonexistent', 'Design', 'active')"
        )
        .run();
    }).toThrow();
  });

  it("enforces unique pipeline names", () => {
    db.raw
      .prepare(
        "INSERT INTO pipelines (id, name, config) VALUES ('p1', 'Test', '{}')"
      )
      .run();
    expect(() => {
      db.raw
        .prepare(
          "INSERT INTO pipelines (id, name, config) VALUES ('p2', 'Test', '{}')"
        )
        .run();
    }).toThrow();
  });

  it("enforces unique stage_progress per feature/stage/step", () => {
    db.raw
      .prepare(
        "INSERT INTO pipelines (id, name, config) VALUES ('p1', 'Test', '{}')"
      )
      .run();
    db.raw
      .prepare(
        "INSERT INTO features (id, title, pipeline_id, current_stage, status) VALUES ('f1', 'Feat', 'p1', 'Design', 'active')"
      )
      .run();
    db.raw
      .prepare(
        "INSERT INTO stage_progress (id, feature_id, stage) VALUES ('sp1', 'f1', 'Design')"
      )
      .run();
    expect(() => {
      db.raw
        .prepare(
          "INSERT INTO stage_progress (id, feature_id, stage) VALUES ('sp2', 'f1', 'Design')"
        )
        .run();
    }).toThrow();
  });
});

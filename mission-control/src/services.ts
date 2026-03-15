// mission-control/src/services.ts
import type { MissionControlDb } from "./db.js";
import type { Service, ServiceLink } from "./types.js";

export function registerService(
  db: MissionControlDb,
  params: {
    name: string;
    path: string;
    stack: string;
    metadata?: Record<string, unknown>;
  }
): Service {
  const now = new Date().toISOString();
  db.raw
    .prepare(
      "INSERT INTO services (name, path, stack, metadata, created_at) VALUES (?, ?, ?, ?, ?)"
    )
    .run(
      params.name,
      params.path,
      params.stack,
      params.metadata ? JSON.stringify(params.metadata) : null,
      now
    );
  return {
    name: params.name,
    path: params.path,
    stack: params.stack,
    metadata: params.metadata,
    created_at: now,
  };
}

export function listServices(db: MissionControlDb): Service[] {
  const rows = db.raw
    .prepare("SELECT * FROM services")
    .all() as Record<string, unknown>[];
  return rows.map((r) => ({
    name: r.name as string,
    path: r.path as string,
    stack: r.stack as string,
    metadata: r.metadata ? JSON.parse(r.metadata as string) : undefined,
    created_at: r.created_at as string,
  }));
}

export function linkFeatureService(
  db: MissionControlDb,
  featureId: string,
  serviceName: string
): void {
  db.raw
    .prepare(
      "INSERT INTO feature_services (feature_id, service_name, status) VALUES (?, ?, 'pending')"
    )
    .run(featureId, serviceName);
}

export function getFeatureServices(
  db: MissionControlDb,
  featureId: string
): ServiceLink[] {
  return db.raw
    .prepare("SELECT * FROM feature_services WHERE feature_id = ?")
    .all(featureId) as ServiceLink[];
}

export function updateServiceStatus(
  db: MissionControlDb,
  featureId: string,
  serviceName: string,
  status: "pending" | "in_progress" | "completed"
): void {
  const result = db.raw
    .prepare(
      "UPDATE feature_services SET status = ? WHERE feature_id = ? AND service_name = ?"
    )
    .run(status, featureId, serviceName);
  if (result.changes === 0) {
    throw new Error(
      `Service link not found: feature=${featureId} service=${serviceName}`
    );
  }
}

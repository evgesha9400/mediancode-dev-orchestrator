// mission-control/src/types.ts

export interface Node {
  name: string;
  executor: "agent" | "human" | "script" | "webhook";
  config: {
    skill?: string;
    command?: string;
    description: string;
    agent_instructions?: string;
  };
  exit_conditions: {
    required_artifacts?: string[];
    human_approval: boolean;
    all_children_complete?: boolean;
  };
  children?: Node[];
  document?: string;
  metadata?: Record<string, unknown>;
}

export interface Pipeline {
  id: string;
  name: string;
  stages: Node[];
  created_at: string;
  updated_at: string;
}

export interface Feature {
  id: string;
  title: string;
  description: string;
  pipeline_id: string;
  current_stage: string;
  status: "active" | "paused" | "completed" | "cancelled";
  weight: number;
  stage_progress: StageProgress[];
  service_links: ServiceLink[];
  notes: FeatureNote[];
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface StageProgress {
  stage: string;
  status: "pending" | "in_progress" | "completed" | "skipped";
  step_progress?: StepProgress[];
  artifacts: Artifact[];
  started_at?: string;
  completed_at?: string;
}

export interface StepProgress {
  step: string;
  status: "pending" | "in_progress" | "completed" | "skipped";
  artifacts: Artifact[];
  started_at?: string;
  completed_at?: string;
}

export interface Artifact {
  id: string;
  feature_id: string;
  stage: string;
  step: string;
  type: string;
  content: string;
  created_at: string;
}

export interface FeatureNote {
  id: string;
  feature_id: string;
  content: string;
  author: string;
  created_at: string;
}

export interface ServiceLink {
  feature_id: string;
  service_name: string;
  status: "pending" | "in_progress" | "completed";
}

export interface Service {
  name: string;
  path: string;
  stack: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export const STAGE_SENTINEL = "__stage__" as const;

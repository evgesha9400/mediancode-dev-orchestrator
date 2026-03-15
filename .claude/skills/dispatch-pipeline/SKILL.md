---
name: dispatch-pipeline
description: Use when starting work on a feature — creates it in Mission Control, registers services, and dispatches stage agents
---

# Dispatch Pipeline

## When to Use

When starting work on a new feature that should flow through the delivery pipeline.

## Process

1. **Check for existing pipeline**: Call `list_pipelines` to verify the software-dev pipeline exists
2. **Create the feature**: Call `create_feature` with title, description, and pipeline_id
3. **Link services**: Call `link_feature_service` for each affected service (frontend, backend)
4. **Read stage document**: Call `get_document_path` for the first stage, then read the document
5. **Begin first stage**: Update status to in_progress and begin work

## Example

```
User: "Implement the relationships feature"

Agent:
1. list_pipelines → find software-dev pipeline ID
2. create_feature(title="Relationships", description="...", pipeline_id=...)
3. link_feature_service(feature_id, "frontend")
4. link_feature_service(feature_id, "backend")
5. get_document_path(pipeline_id, "Design") → read the document
6. update_step_status(feature_id, "Design", null, "in_progress")
7. Begin design work...
```

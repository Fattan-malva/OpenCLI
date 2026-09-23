# 06 — Task and Workflow System

## Task lifecycle

```text
PENDING
  |
READY
  |
RUNNING
  |
+----> PAUSED
|
+----> FAILED
|
+----> REVIEW
        |
        v
    COMPLETED
```

## Task graph

```text
T001 Architecture
      |
 +----+----+
 |         |
 v         v
T002      T003
Auth       API
 |         |
 +----+----+
      |
      v
     T004
   Product
      |
      v
     T005
    Testing
```

## Dependency rules

A task becomes READY only when all required dependencies are completed or explicitly accepted.

## Workflow

```yaml
workflow:
  name: feature-development

  stages:
    - plan
    - build
    - review
    - test
    - integrate
```

## Agent assignment

A task may explicitly define:

```text
agent
mode
model
provider
workspace
```

If omitted, routing rules and capability matching determine defaults.

## Automatic decomposition

The planner can transform a user request into tasks, but the resulting plan should be inspectable before execution when policy requires approval.

## Handoff

When a task completes, it may produce:
- files
- commits
- API contracts
- test results
- notes
- decisions
- warnings

These become structured artifacts for dependent tasks.

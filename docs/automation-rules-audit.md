# Automation Rules Audit Trail

This document describes the audit trail capabilities for automation rules, including rule change history, execution history, actor tracking, search, and export.

## Overview

The automation rules system keeps a complete, searchable, and exportable history of:

1. **Rule changes** - every create, update, delete, activate, and deactivate event
2. **Rule executions** - every evaluation/run of an automation rule
3. **Actor tracking** - who or what initiated each change or execution
4. **Version snapshots** - full point-in-time snapshots of rule configuration

This makes it possible to answer questions such as:

- Who changed a rule and when?
- What did a rule look like at version N?
- How many times has a rule executed in the last 24 hours?
- Which user or system account triggered a specific execution?

## Data Model

### `automation_rules`

Stores the current state of each automation rule.

| Column            | Type    | Description                                              |
| ----------------- | ------- | -------------------------------------------------------- |
| id                | UUID    | Primary key                                              |
| name              | text    | Human-readable rule name                                 |
| description       | text    | Optional description                                     |
| asset_code        | text    | Asset the rule monitors                                  |
| conditions        | jsonb   | Array of threshold conditions                            |
| logic_operator    | text    | `AND` or `OR`                                            |
| actions           | jsonb   | Actions to execute when the rule triggers                |
| status            | text    | `active`, `inactive`, or `draft`                         |
| owner_address     | text    | Rule owner                                               |
| cooldown_seconds  | integer | Minimum time between executions                          |
| last_executed_at  | ts      | Last execution timestamp                                 |
| execution_count   | integer | Total number of executions                               |
| version           | integer | Monotonically increasing version number                  |
| created_at        | ts      | Creation timestamp                                       |
| updated_at        | ts      | Last update timestamp                                    |

### `automation_rule_versions`

Append-only audit log of rule changes. One row per change event.

| Column        | Type    | Description                                              |
| ------------- | ------- | -------------------------------------------------------- |
| id            | UUID    | Primary key                                              |
| rule_id       | UUID    | Reference to `automation_rules`                          |
| version       | integer | Version number at the time of the change                 |
| snapshot      | jsonb   | Full rule snapshot                                       |
| changed_by    | text    | Actor that made the change                               |
| change_type   | text    | `create`, `update`, `delete`, `activate`, `deactivate`   |
| change_reason | text    | Optional human-readable reason                           |
| created_at    | ts      | Timestamp of the change                                  |

### `automation_rule_executions`

Append-only history of rule executions.

| Column            | Type    | Description                                              |
| ----------------- | ------- | -------------------------------------------------------- |
| id                | UUID    | Primary key                                              |
| rule_id           | UUID    | Reference to `automation_rules`                          |
| rule_version      | integer | Rule version that was executed                           |
| input_metrics     | jsonb   | Metrics supplied to the rule                             |
| condition_results | jsonb   | Result of each condition evaluation                      |
| triggered         | bool    | Whether the rule fired                                   |
| actions_executed  | jsonb   | Actions that were run                                    |
| action_results    | jsonb   | Per-action results                                       |
| status            | text    | `completed`, `failed`, or `partial`                      |
| error_message     | text    | Error details when status is not `completed`             |
| executed_by       | text    | Actor/system that triggered the execution                |
| started_at        | ts      | Execution start time                                     |
| completed_at      | ts      | Execution end time                                       |
| duration_ms       | int     | Execution duration in milliseconds                       |
| created_at        | ts      | Row insertion time                                       |

### `rule_evaluator_logs` (enhanced)

The existing rule evaluator log table has been extended with actor tracking columns:

| Column            | Type    | Description                                              |
| ----------------- | ------- | -------------------------------------------------------- |
| executed_by       | text    | Actor/system that triggered the evaluation               |
| execution_context | text    | Context such as `manual`, `scheduled`, `webhook`, `api`  |
| metadata          | jsonb   | Additional execution metadata                            |

## API Endpoints

All endpoints are prefixed with `/api/v1/automation-rules` unless otherwise noted.

### Rule Management

| Method | Endpoint               | Description                                              |
| ------ | ---------------------- | -------------------------------------------------------- |
| GET    | `/`                    | List automation rules                                    |
| GET    | `/:id`                 | Get a single rule                                        |
| POST   | `/`                    | Create a new rule                                        |
| PATCH  | `/:id`                 | Update a rule                                            |
| DELETE | `/:id`                 | Delete a rule                                            |
| POST   | `/:id/activate`        | Activate a rule                                          |
| POST   | `/:id/deactivate`      | Deactivate a rule                                        |

### Audit Trail

| Method | Endpoint                            | Description                                              |
| ------ | ----------------------------------- | -------------------------------------------------------- |
| GET    | `/history`                          | List rule change history                                 |
| GET    | `/history/search`                   | Search rule change history                               |
| GET    | `/history/export`                   | Export rule change history as CSV                        |
| GET    | `/:id/versions/:from/compare/:to`   | Compare two rule versions                                |
| GET    | `/executions`                       | List rule execution history                              |
| GET    | `/executions/export`                | Export execution history as CSV                          |

### Rule Evaluator History

The existing rule evaluator endpoints at `/api/v1/rule-evaluator` also support actor-aware queries:

| Method | Endpoint             | Description                                              |
| ------ | -------------------- | -------------------------------------------------------- |
| GET    | `/evaluate/history`  | List evaluation history (supports `executedBy`, etc.)    |

## Query Parameters

### Rule History

- `ruleId` - filter by rule
- `changedBy` - filter by actor
- `changeType` - `create`, `update`, `delete`, `activate`, `deactivate`
- `from`, `to` - ISO 8601 date range
- `limit`, `offset` - pagination

### Search Rule History

Same filters as rule history plus:

- `q` - free-text search across change reason and rule snapshot JSON

### Execution History

- `ruleId` - filter by rule
- `ruleVersion` - filter by rule version
- `triggered` - `true` or `false`
- `status` - `completed`, `failed`, `partial`
- `executedBy` - filter by actor
- `from`, `to` - ISO 8601 date range
- `limit`, `offset` - pagination

## Actor Tracking

Every rule change and execution records the actor that initiated it.

- `user` - authenticated user address
- `api_key` - API key identifier
- `system` - internal scheduler or worker

For rule evaluator calls, the request body may include:

```json
{
  "executedBy": "user-123",
  "executionContext": "manual"
}
```

If omitted, the evaluator defaults to `executedBy: "system"` and `executionContext: "api"`.

## Export Format

### Rule History CSV

```csv
id,rule_id,version,change_type,changed_by,change_reason,created_at
"version-1","rule-1","1","create","user-1","Initial rule creation","2026-06-18T14:00:00.000Z"
```

### Execution History CSV

```csv
id,rule_id,rule_version,triggered,status,executed_by,started_at,completed_at,duration_ms,created_at
"exec-1","rule-1","2","true","completed","system","2026-06-18T14:00:00.000Z","2026-06-18T14:00:01.000Z","100","2026-06-18T14:00:01.000Z"
```

## Integration with General Audit Log

Rule creation, update, and deletion events are also written to the central `audit_logs` table via `auditService.log`. This enables cross-resource audit queries from `/api/v1/admin/audit` using:

- `resourceType=automation_rule`
- `action=alert.rule_created`, `alert.rule_updated`, or `alert.rule_deleted`

## Retention

No automatic retention is applied by the new tables. Operators can add retention policies or periodic cleanup jobs based on `created_at` in `automation_rule_versions` and `automation_rule_executions`.

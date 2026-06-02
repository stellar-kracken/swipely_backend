# Query Preset Service

Store and manage reusable query presets for common reports and API requests.

## Overview

The Query Preset Service allows users to save commonly used query configurations for quick reuse. Presets can be private or shared with other users, and include versioning support for tracking changes over time.

## Features

- **Preset CRUD**: Create, read, update, and delete query presets
- **Shared Presets**: Make presets available to other users
- **Versioning**: Automatic version tracking when query definitions change
- **Access Control**: Role-based access rules for preset sharing
- **Usage Tracking**: Track when presets were last used
- **Search & Filter**: Find presets by category, name, or description

## Data Model

### Query Preset

```typescript
{
  id: string;              // UUID
  name: string;            // Preset name
  description?: string;    // Optional description
  category: string;        // Category (reports, analytics, alerts, monitoring)
  query_definition: {      // Query configuration
    filters: object;       // Filter criteria
    fields: string[];      // Fields to return
    sort?: object;         // Sort configuration
    limit?: number;        // Result limit
  };
  is_shared: boolean;      // Whether preset is shared
  created_by: string;      // Creator user ID
  version: string;         // Current version (semver)
  access_rules: {          // Access control
    allowedUsers?: string[];
    allowedRoles?: string[];
  };
  metadata?: object;       // Additional metadata
  created_at: Date;
  updated_at: Date;
  last_used_at?: Date;
}
```

### Query Preset Version

```typescript
{
  id: string;              // UUID
  preset_id: string;       // Parent preset ID
  version: string;         // Version number
  query_definition: object;// Query definition for this version
  change_notes?: string;   // Notes about changes
  created_by: string;      // User who created this version
  created_at: Date;
}
```

## API Endpoints

### Create Preset

```http
POST /api/v1/query-presets
Content-Type: application/json

{
  "name": "High Severity Alerts",
  "description": "Query for high and critical severity alerts",
  "category": "alerts",
  "query_definition": {
    "filters": {
      "severity": ["high", "critical"]
    },
    "fields": ["id", "message", "severity", "created_at"],
    "sort": { "created_at": "desc" },
    "limit": 100
  },
  "is_shared": true
}
```

### List Presets

```http
GET /api/v1/query-presets?category=alerts&search=severity
```

### Get Preset

```http
GET /api/v1/query-presets/:id
```

### Update Preset

```http
PATCH /api/v1/query-presets/:id
Content-Type: application/json

{
  "name": "Updated Name",
  "query_definition": { ... },
  "change_notes": "Added new filter criteria"
}
```

### Delete Preset

```http
DELETE /api/v1/query-presets/:id
```

### Get Version History

```http
GET /api/v1/query-presets/:id/versions
```

## Query Definition Syntax

Query definitions support flexible configuration for different data sources:

```typescript
{
  // Required fields
  filters: {
    field_name: value,           // Exact match
    field_name: [val1, val2],    // IN clause
    field_name: { $gte: value }, // Comparison operators
  },
  fields: ["field1", "field2"],  // Fields to return

  // Optional fields
  sort: {
    field: "asc" | "desc"
  },
  limit: number,
  offset: number,
  aggregations: {
    field: "count" | "sum" | "avg" | "min" | "max"
  }
}
```

## Categories

Standard preset categories:

- **reports**: Scheduled report queries
- **analytics**: Analytics and metrics queries
- **alerts**: Alert filtering and search
- **monitoring**: System monitoring queries

## Access Control

### Private Presets

By default, presets are private and only accessible to the creator.

### Shared Presets

Set `is_shared: true` to make a preset available to all users.

### Custom Access Rules

Use `access_rules` for fine-grained control:

```typescript
{
  access_rules: {
    allowedUsers: ["user-id-1", "user-id-2"],
    allowedRoles: ["admin", "analyst"]
  }
}
```

## Versioning

Versions are automatically created when the `query_definition` is updated:

- Initial version: `1.0.0`
- Each update increments: `1.0.1`, `1.0.2`, etc.
- Include `change_notes` when updating to document changes

## Usage Examples

### Alert Dashboard Preset

```json
{
  "name": "Active Critical Alerts",
  "category": "alerts",
  "query_definition": {
    "filters": {
      "severity": "critical",
      "status": "active"
    },
    "fields": ["id", "asset_code", "message", "created_at"],
    "sort": { "created_at": "desc" }
  }
}
```

### Bridge Health Report

```json
{
  "name": "Bridge Health Summary",
  "category": "reports",
  "query_definition": {
    "filters": {
      "is_active": true
    },
    "fields": ["name", "status", "total_value_locked", "health_score"],
    "sort": { "health_score": "asc" }
  }
}
```

### Asset Analytics

```json
{
  "name": "Top Assets by Volume",
  "category": "analytics",
  "query_definition": {
    "filters": {
      "is_active": true
    },
    "fields": ["symbol", "name", "total_volume"],
    "sort": { "total_volume": "desc" },
    "limit": 10
  }
}
```

## Caching

Query presets are cached for 1 hour after retrieval. Cache is automatically invalidated on updates or deletes.

## Best Practices

1. **Use descriptive names**: Make preset names clear and searchable
2. **Add descriptions**: Explain what the preset is used for
3. **Version carefully**: Include meaningful change notes
4. **Share wisely**: Only share presets that are useful to others
5. **Clean up unused**: Delete presets that are no longer needed
6. **Test definitions**: Validate query definitions before saving

## Security Considerations

- Users can only modify their own presets
- Access rules are enforced on all operations
- Query definitions are validated before execution
- Shared presets are read-only for non-owners

## Related Services

- **Export Service**: Use presets for recurring exports
- **Analytics Service**: Reference presets in analytics queries
- **Alert Service**: Apply presets to alert searches

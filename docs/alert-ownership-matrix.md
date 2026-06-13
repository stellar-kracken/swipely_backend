# Alert Ownership Matrix

## Overview

The Alert Ownership Matrix is a system for tracking which team or individual owns each alert in Bridge-Watch. It provides:

- **Ownership Assignment**: Assign alerts to users or teams
- **Ownership Transfer**: Transfer ownership with full audit trail
- **Escalation Contacts**: Define ordered escalation paths for each alert
- **Audit History**: Complete, tamper-proof history of all ownership changes
- **Export Capabilities**: Export ownership data in CSV or JSON format
- **Search**: Search across alerts, owners, and teams

## Ownership Workflow

### 1. Assign Ownership

When an alert is created, ownership can be assigned to a user or team:

```bash
POST /api/v1/alerts/:alertId/ownership
Content-Type: application/json
x-api-key: your-api-key

{
  "ownerId": "0x1234...abcd",
  "ownerType": "user",
  "actorId": "0x5678...efgh"
}
```

**Owner Types**:
- `user`: Individual user (identified by wallet address)
- `team`: Team (identified by team identifier)

### 2. Transfer Ownership

Ownership can be transferred by assigning a new owner to an already-owned alert. The previous owner is automatically recorded in the audit log:

```bash
POST /api/v1/alerts/:alertId/ownership
Content-Type: application/json
x-api-key: your-api-key

{
  "ownerId": "0xnew...owner",
  "ownerType": "user",
  "actorId": "0x5678...efgh"
}
```

### 3. Add Escalation Contacts

Define an ordered list of contacts for alert escalation:

```bash
POST /api/v1/alerts/:alertId/escalation
Content-Type: application/json
x-api-key: your-api-key

{
  "contactUserId": "0xcontact...1234",
  "order": 1,
  "actorId": "0x5678...efgh"
}
```

**Escalation Order**: Contacts are ordered by the `order` field (1, 2, 3, ...). Lower numbers are contacted first.

### 4. Remove Escalation Contacts

```bash
DELETE /api/v1/alerts/:alertId/escalation/:contactUserId
Content-Type: application/json
x-api-key: your-api-key

{
  "actorId": "0x5678...efgh"
}
```

## API Endpoints

### Ownership Management

#### Assign or Transfer Ownership
```
POST /api/v1/alerts/:alertId/ownership
```

**Authentication**: Required (admin or current owner)

**Request Body**:
```json
{
  "ownerId": "string",
  "ownerType": "user" | "team",
  "actorId": "string"
}
```

**Response** (200):
```json
{
  "ownership": {
    "id": "uuid",
    "alertId": "uuid",
    "ownerType": "user",
    "ownerId": "0x1234...abcd",
    "createdBy": "0x5678...efgh",
    "createdAt": "2026-01-15T10:30:00Z"
  }
}
```

#### Get Current Owner
```
GET /api/v1/alerts/:alertId/ownership
```

**Authentication**: Required

**Response** (200):
```json
{
  "ownership": {
    "id": "uuid",
    "alertId": "uuid",
    "ownerType": "user",
    "ownerId": "0x1234...abcd",
    "createdBy": "0x5678...efgh",
    "createdAt": "2026-01-15T10:30:00Z"
  }
}
```

Returns `{ "ownership": null }` if alert has no owner.

### Ownership Matrix

#### Get Ownership Matrix
```
GET /api/v1/ownership/matrix
```

**Authentication**: Required

**Query Parameters**:
- `teamId` (optional): Filter by team
- `ownerId` (optional): Filter by owner
- `alertId` (optional): Filter by alert
- `groupBy` (optional): `team` or `none` (default: `none`)
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 50, max: 100)

**Response** (200):
```json
{
  "data": [
    {
      "alertId": "uuid",
      "alertName": "USDC Health Drop",
      "ownerType": "user",
      "ownerId": "0x1234...abcd",
      "createdBy": "0x5678...efgh",
      "createdAt": "2026-01-15T10:30:00Z",
      "escalationContacts": [
        { "contactUserId": "0xcontact1", "order": 1 },
        { "contactUserId": "0xcontact2", "order": 2 }
      ]
    }
  ],
  "meta": {
    "total": 42,
    "page": 1,
    "limit": 50,
    "totalPages": 1
  }
}
```

**Grouped by Team** (`?groupBy=team`):
```json
{
  "teams": [
    {
      "teamId": "team-alpha",
      "alerts": [
        {
          "alertId": "uuid",
          "alertName": "USDC Health Drop",
          "ownerType": "team",
          "ownerId": "team-alpha",
          "createdBy": "0x5678...efgh",
          "createdAt": "2026-01-15T10:30:00Z",
          "escalationContacts": []
        }
      ]
    }
  ]
}
```

### Escalation Contacts

#### Add Escalation Contact
```
POST /api/v1/alerts/:alertId/escalation
```

**Authentication**: Required (admin or current owner)

**Request Body**:
```json
{
  "contactUserId": "0xcontact...1234",
  "order": 1,
  "actorId": "0x5678...efgh"
}
```

**Response** (201):
```json
{
  "contact": {
    "id": "uuid",
    "alertId": "uuid",
    "contactUserId": "0xcontact...1234",
    "order": 1,
    "createdBy": "0x5678...efgh",
    "createdAt": "2026-01-15T10:30:00Z"
  }
}
```

#### Get Escalation Contacts
```
GET /api/v1/alerts/:alertId/escalation
```

**Authentication**: Required

**Response** (200):
```json
{
  "contacts": [
    {
      "id": "uuid",
      "alertId": "uuid",
      "contactUserId": "0xcontact1",
      "order": 1,
      "createdBy": "0x5678...efgh",
      "createdAt": "2026-01-15T10:30:00Z"
    },
    {
      "id": "uuid",
      "alertId": "uuid",
      "contactUserId": "0xcontact2",
      "order": 2,
      "createdBy": "0x5678...efgh",
      "createdAt": "2026-01-15T10:30:00Z"
    }
  ]
}
```

#### Remove Escalation Contact
```
DELETE /api/v1/alerts/:alertId/escalation/:contactUserId
```

**Authentication**: Required (admin or current owner)

**Request Body**:
```json
{
  "actorId": "0x5678...efgh"
}
```

**Response** (200):
```json
{
  "success": true
}
```

### Audit History

#### Get Ownership Audit History
```
GET /api/v1/alerts/:alertId/ownership/history
```

**Authentication**: Required

**Query Parameters**:
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 50, max: 100)

**Response** (200):
```json
{
  "entries": [
    {
      "id": "uuid",
      "action": "alert.ownership_transferred",
      "actorId": "0x5678...efgh",
      "before": {
        "ownerType": "user",
        "ownerId": "0xold...owner"
      },
      "after": {
        "ownerType": "user",
        "ownerId": "0xnew...owner"
      },
      "metadata": {
        "alertName": "USDC Health Drop"
      },
      "createdAt": "2026-01-15T10:30:00Z"
    }
  ],
  "meta": {
    "total": 5,
    "page": 1,
    "limit": 50,
    "totalPages": 1
  }
}
```

**Audit Actions**:
- `alert.ownership_assigned`: Initial ownership assignment
- `alert.ownership_transferred`: Ownership transferred to new owner
- `alert.escalation_added`: Escalation contact added
- `alert.escalation_removed`: Escalation contact removed

### Export

#### Export Ownership Matrix
```
GET /api/v1/ownership/export
```

**Authentication**: Required (admin only)

**Query Parameters**:
- `format` (required): `csv` or `json`
- `teamId` (optional): Filter by team
- `ownerId` (optional): Filter by owner
- `alertId` (optional): Filter by alert

**Response** (200):
- **CSV**: `Content-Type: text/csv`
- **JSON**: `Content-Type: application/json`

**CSV Columns**:
```
alert_id,alert_name,owner_type,owner_id,created_by,created_at,escalation_contacts
```

**Example**:
```bash
curl -H "x-api-key: your-key" \
  "https://api.bridge-watch.io/api/v1/ownership/export?format=csv" \
  -o ownership-matrix.csv
```

### Search

#### Search Ownership
```
GET /api/v1/ownership/search
```

**Authentication**: Required

**Query Parameters**:
- `q` (required): Search query
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 50, max: 100)

**Searchable Fields**:
- Alert name
- Owner ID
- Team ID (if owner type is team)

**Response** (200): Same format as `GET /ownership/matrix`

**Example**:
```bash
curl -H "x-api-key: your-key" \
  "https://api.bridge-watch.io/api/v1/ownership/search?q=USDC&page=1&limit=20"
```

## Audit History Semantics

### Append-Only

All ownership changes are recorded in an **append-only** audit log. No endpoint allows modification or deletion of audit entries.

### Tamper Detection

Each audit entry includes a SHA-256 checksum computed from:
- Action
- Actor ID
- Actor type
- Resource type
- Resource ID
- Before state
- After state
- Severity

The checksum can be verified using the audit service's `verifyChecksum()` method.

### Retention

Audit logs follow the system-wide retention policy configured in the audit service. By default:
- `info` severity: Retained according to retention policy
- `warning` and `critical` severity: Retained indefinitely

## Export Formats

### CSV

**Columns**:
1. `alert_id`: UUID of the alert
2. `alert_name`: Human-readable alert name
3. `owner_type`: `user` or `team`
4. `owner_id`: Owner identifier (wallet address or team ID)
5. `created_by`: Actor who assigned ownership
6. `created_at`: ISO 8601 timestamp
7. `escalation_contacts`: Semicolon-separated list of contacts with order (e.g., `contact1(1); contact2(2)`)

**Example**:
```csv
alert_id,alert_name,owner_type,owner_id,created_by,created_at,escalation_contacts
550e8400-e29b-41d4-a716-446655440000,USDC Health Drop,user,0x1234...abcd,0x5678...efgh,2026-01-15T10:30:00Z,0xcontact1(1); 0xcontact2(2)
```

### JSON

Returns the same structure as `GET /ownership/matrix` (array of ownership entries).

**Example**:
```json
[
  {
    "alertId": "550e8400-e29b-41d4-a716-446655440000",
    "alertName": "USDC Health Drop",
    "ownerType": "user",
    "ownerId": "0x1234...abcd",
    "createdBy": "0x5678...efgh",
    "createdAt": "2026-01-15T10:30:00.000Z",
    "escalationContacts": [
      { "contactUserId": "0xcontact1", "order": 1 },
      { "contactUserId": "0xcontact2", "order": 2 }
    ]
  }
]
```

## Search Behavior

The search endpoint uses **case-insensitive ILIKE** queries against:
- `alert_rules.name`
- `alert_ownership.owner_id`

**Examples**:
- `?q=USDC` → Matches alerts with "USDC" in name or owner ID
- `?q=0x1234` → Matches alerts owned by addresses starting with "0x1234"
- `?q=team-alpha` → Matches alerts owned by "team-alpha"

## Authentication Requirements

| Endpoint | Required Auth | Required Scopes |
|----------|---------------|-----------------|
| POST `/alerts/:alertId/ownership` | Yes | None (owner check in service) |
| GET `/alerts/:alertId/ownership` | Yes | None |
| GET `/ownership/matrix` | Yes | None |
| POST `/alerts/:alertId/escalation` | Yes | None (owner check in service) |
| GET `/alerts/:alertId/escalation` | Yes | None |
| DELETE `/alerts/:alertId/escalation/:contactUserId` | Yes | None (owner check in service) |
| GET `/alerts/:alertId/ownership/history` | Yes | None |
| GET `/ownership/export` | Yes | `admin:ownership` |
| GET `/ownership/search` | Yes | None |

**Note**: Endpoints that modify ownership or escalation contacts verify that the `actorId` matches the current owner or has admin privileges. This check is performed at the service layer.

## Security & PII

### PII Handling

Owner IDs and contact user IDs are considered **PII-adjacent** (wallet addresses). They are:
- Never logged at production level (use `logger.debug()` if needed)
- Included in audit logs (which have restricted access)
- Exported only via admin-restricted endpoint

### Audit Log Immutability

The audit log is **append-only**. No endpoint allows:
- Updating audit entries
- Deleting audit entries

This is enforced at the service layer (no update/delete methods) and verified in tests.

### Export Restrictions

The export endpoint requires the `admin:ownership` scope to prevent unauthorized access to the full ownership matrix, which could expose organizational structure.

## Examples

### Complete Ownership Workflow

```bash
# 1. Assign ownership to a user
curl -X POST https://api.bridge-watch.io/api/v1/alerts/550e8400-e29b-41d4-a716-446655440000/ownership \
  -H "x-api-key: your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "ownerId": "0x1234567890abcdef",
    "ownerType": "user",
    "actorId": "0xadmin123"
  }'

# 2. Add escalation contacts
curl -X POST https://api.bridge-watch.io/api/v1/alerts/550e8400-e29b-41d4-a716-446655440000/escalation \
  -H "x-api-key: your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "contactUserId": "0xcontact1",
    "order": 1,
    "actorId": "0x1234567890abcdef"
  }'

curl -X POST https://api.bridge-watch.io/api/v1/alerts/550e8400-e29b-41d4-a716-446655440000/escalation \
  -H "x-api-key: your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "contactUserId": "0xcontact2",
    "order": 2,
    "actorId": "0x1234567890abcdef"
  }'

# 3. Transfer ownership to a team
curl -X POST https://api.bridge-watch.io/api/v1/alerts/550e8400-e29b-41d4-a716-446655440000/ownership \
  -H "x-api-key: your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "ownerId": "team-alpha",
    "ownerType": "team",
    "actorId": "0x1234567890abcdef"
  }'

# 4. View audit history
curl https://api.bridge-watch.io/api/v1/alerts/550e8400-e29b-41d4-a716-446655440000/ownership/history \
  -H "x-api-key: your-key"

# 5. Export full ownership matrix (admin only)
curl https://api.bridge-watch.io/api/v1/ownership/export?format=csv \
  -H "x-api-key: admin-key" \
  -o ownership-matrix.csv
```

## Troubleshooting

### "Alert not found"
- Verify the alert ID exists in the `alert_rules` table
- Check that the alert has not been deleted

### "Contact already exists for this alert"
- Each contact can only be added once per alert
- Remove the existing contact before re-adding with a different order

### "Forbidden" on export endpoint
- Export requires `admin:ownership` scope
- Verify your API key has the required scope

### Audit history is empty
- Ownership changes are only logged after the ownership matrix feature is deployed
- Historical ownership data (before this feature) is not retroactively audited

## Related Documentation

- [Audit Logging](./audit-logging.md)
- [Alert System](./alert-system.md)
- [API Authentication](./api-authentication.md)

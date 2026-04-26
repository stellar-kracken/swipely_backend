# Admin Rotation System

## Overview

The Admin Rotation system provides safe and auditable management of system administrator accounts with built-in safeguards to prevent lockouts and unauthorized access.

## Features

### Core Capabilities

- **Add/Remove Admins**: Safely add new administrators or deactivate existing ones
- **Role Management**: Assign and modify admin roles (super_admin, operator, auditor, viewer)
- **Activation Control**: Activate or deactivate admin accounts
- **Minimum Admin Count**: Enforces minimum of 2 active admins to prevent lockout
- **Audit Trail**: Complete history of all admin rotation events
- **Multi-sig Proposals**: Optional approval workflow for sensitive operations

### Admin Roles

- **super_admin**: Full system access, can manage other admins
- **operator**: Operational access, can manage bridges and alerts
- **auditor**: Read-only access to audit logs and system state
- **viewer**: Read-only access to system data

## API Endpoints

### Admin Management

#### List All Admins
```http
GET /api/v1/admin/rotation/admins?activeOnly=true
Authorization: x-api-key: <admin-key>
```

#### Get Admin by Address
```http
GET /api/v1/admin/rotation/admins/:address
Authorization: x-api-key: <admin-key>
```

#### Add New Admin
```http
POST /api/v1/admin/rotation/admins
Authorization: x-api-key: <admin-key>
Content-Type: application/json

{
  "address": "GADMIN123...",
  "name": "John Doe",
  "email": "john@example.com",
  "roles": ["operator", "auditor"],
  "reason": "New team member"
}
```

#### Remove Admin (Deactivate)
```http
DELETE /api/v1/admin/rotation/admins/:address
Authorization: x-api-key: <admin-key>
Content-Type: application/json

{
  "reason": "Team member departure"
}
```

**Note**: Cannot remove admin if it would violate minimum admin count (2).

#### Change Admin Roles
```http
PATCH /api/v1/admin/rotation/admins/:address/roles
Authorization: x-api-key: <admin-key>
Content-Type: application/json

{
  "roles": ["super_admin"],
  "reason": "Promotion to super admin"
}
```

#### Activate Admin
```http
POST /api/v1/admin/rotation/admins/:address/activate
Authorization: x-api-key: <admin-key>
```

#### Get Rotation Events
```http
GET /api/v1/admin/rotation/events?adminAddress=GADMIN123&limit=50
Authorization: x-api-key: <admin-key>
```

#### Get Active Admin Count
```http
GET /api/v1/admin/rotation/admins/stats/count
Authorization: x-api-key: <admin-key>
```

### Proposal System (Multi-sig Workflow)

For sensitive operations, use the proposal system to require multiple approvals.

#### List Proposals
```http
GET /api/v1/admin/rotation/proposals?status=pending
Authorization: x-api-key: <admin-key>
```

#### Get Proposal by ID
```http
GET /api/v1/admin/rotation/proposals/:id
Authorization: x-api-key: <admin-key>
```

#### Create Proposal
```http
POST /api/v1/admin/rotation/proposals
Authorization: x-api-key: <admin-key>
Content-Type: application/json

{
  "proposalType": "add_admin",
  "targetAddress": "GADMIN456...",
  "proposedChanges": {
    "name": "Jane Smith",
    "email": "jane@example.com",
    "roles": ["operator"]
  },
  "requiredApprovals": 2,
  "expiresInHours": 72
}
```

**Proposal Types**:
- `add_admin`: Add new administrator
- `remove_admin`: Remove existing administrator
- `change_roles`: Modify admin roles

#### Approve Proposal
```http
POST /api/v1/admin/rotation/proposals/:id/approve
Authorization: x-api-key: <admin-key>
Content-Type: application/json

{
  "approverAddress": "GADMIN789..."
}
```

#### Reject Proposal
```http
POST /api/v1/admin/rotation/proposals/:id/reject
Authorization: x-api-key: <admin-key>
Content-Type: application/json

{
  "rejectorAddress": "GADMIN789...",
  "reason": "Insufficient justification"
}
```

#### Execute Approved Proposal
```http
POST /api/v1/admin/rotation/proposals/:id/execute
Authorization: x-api-key: <admin-key>
Content-Type: application/json

{
  "executorAddress": "GADMIN789..."
}
```

## Safeguards

### Minimum Admin Count
- System enforces minimum of 2 active admins
- Prevents accidental lockout
- Removal attempts that violate this rule are rejected

### Authorization Checks
- All operations require `admin` or `super_admin` scope
- API key authentication required
- Actor identity tracked in audit logs

### Audit Trail
- Every rotation event is logged with:
  - Event type (added, removed, activated, deactivated, role_changed)
  - Admin address
  - Actor address (who performed the action)
  - Before/after state
  - Reason (optional)
  - Timestamp
- Tamper-resistant audit logs via AuditService integration

### Proposal Expiration
- Proposals expire after configured time (default: 72 hours)
- Expired proposals cannot be executed
- Automatic status update to "expired"

## Database Schema

### admin_accounts
Stores administrator account information.

```sql
CREATE TABLE admin_accounts (
  id UUID PRIMARY KEY,
  address TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT,
  roles JSONB NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  added_by TEXT NOT NULL,
  activated_at TIMESTAMP,
  deactivated_at TIMESTAMP,
  deactivated_by TEXT,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);
```

### admin_rotation_events
Audit trail for all rotation operations.

```sql
CREATE TABLE admin_rotation_events (
  id UUID PRIMARY KEY,
  event_type TEXT NOT NULL,
  admin_address TEXT NOT NULL,
  actor_address TEXT NOT NULL,
  before_state JSONB,
  after_state JSONB,
  reason TEXT,
  metadata JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL
);
```

### admin_rotation_proposals
Multi-sig proposal workflow.

```sql
CREATE TABLE admin_rotation_proposals (
  id UUID PRIMARY KEY,
  proposal_type TEXT NOT NULL,
  target_address TEXT NOT NULL,
  proposed_by TEXT NOT NULL,
  proposed_changes JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  approvals JSONB NOT NULL,
  required_approvals INTEGER NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  executed_at TIMESTAMP,
  executed_by TEXT,
  rejection_reason TEXT,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);
```

## Usage Examples

### Example 1: Add New Admin (Direct)
```typescript
import { AdminRotationService } from './services/adminRotation.service';

const service = AdminRotationService.getInstance();

const newAdmin = await service.addAdmin({
  address: 'GADMIN123...',
  name: 'Alice Johnson',
  email: 'alice@example.com',
  roles: ['operator', 'auditor'],
  addedBy: 'GSUPERADMIN...',
  reason: 'New operations team member'
});
```

### Example 2: Add Admin via Proposal (Multi-sig)
```typescript
// Step 1: Create proposal
const proposal = await service.createProposal({
  proposalType: 'add_admin',
  targetAddress: 'GADMIN456...',
  proposedBy: 'GADMIN1...',
  proposedChanges: {
    name: 'Bob Smith',
    email: 'bob@example.com',
    roles: ['super_admin']
  },
  requiredApprovals: 2,
  expiresInHours: 72
});

// Step 2: Other admins approve
await service.approveProposal(proposal.id, 'GADMIN2...');

// Step 3: Execute when approved
await service.executeProposal(proposal.id, 'GADMIN1...');
```

### Example 3: Remove Admin with Safeguard
```typescript
try {
  await service.removeAdmin({
    address: 'GADMIN789...',
    removedBy: 'GSUPERADMIN...',
    reason: 'Team member departure'
  });
} catch (error) {
  // Error: "Cannot remove admin: minimum admin count (2) would be violated"
}
```

### Example 4: Change Admin Roles
```typescript
const updatedAdmin = await service.changeRoles({
  address: 'GADMIN123...',
  newRoles: ['super_admin', 'operator'],
  changedBy: 'GSUPERADMIN...',
  reason: 'Promotion to super admin'
});
```

## Recovery Path

If admin lockout occurs despite safeguards:

1. **Bootstrap Token**: Use `API_KEY_BOOTSTRAP_TOKEN` environment variable
   - Provides temporary super admin access
   - Should be rotated after recovery

2. **Database Access**: Direct database modification as last resort
   ```sql
   -- Activate emergency admin
   UPDATE admin_accounts 
   SET is_active = true, activated_at = NOW()
   WHERE address = 'GEMERGENCY...';
   ```

3. **Audit Review**: Check rotation events to understand what happened
   ```sql
   SELECT * FROM admin_rotation_events 
   ORDER BY created_at DESC 
   LIMIT 50;
   ```

## Best Practices

1. **Always maintain at least 3 active admins** for redundancy
2. **Use proposals for super_admin changes** to require consensus
3. **Document reasons** for all rotation operations
4. **Regular audit reviews** of rotation events
5. **Test recovery procedures** in staging environment
6. **Rotate bootstrap token** after any emergency use
7. **Use role-based access** - assign minimum necessary roles
8. **Set proposal expiration** appropriate to your team's response time

## Event Emission

All rotation operations emit events that can be consumed by:
- Audit logging system
- Monitoring/alerting systems
- Compliance reporting tools

Event types:
- `admin.added`
- `admin.removed`
- `admin.activated`
- `admin.deactivated`
- `admin.role_changed`

## Security Considerations

- All operations require authenticated API key with admin scope
- Minimum admin count prevents lockout
- Complete audit trail for compliance
- Proposal system adds approval layer for sensitive operations
- Bootstrap token provides emergency recovery path
- Tamper-resistant audit logs via SHA256 checksums

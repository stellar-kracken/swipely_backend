export interface AuditEvent {
  id: string;
  actorId: string;
  actorType: "user" | "admin" | "system";
  action: string;
  resourceType: string;
  resourceId: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, any>;
  createdAt: Date;
  checksum: string;
  previousChecksum?: string;
}

export const AuditActions = {
  // Authentication
  LOGIN: "LOGIN",
  LOGOUT: "LOGOUT",
  REGISTER: "REGISTER",
  PASSWORD_RESET: "PASSWORD_RESET",
  MFA_ENABLED: "MFA_ENABLED",
  MFA_DISABLED: "MFA_DISABLED",

  // Bridge Monitoring
  CREATE_ALERT: "CREATE_ALERT",
  UPDATE_ALERT: "UPDATE_ALERT",
  DELETE_ALERT: "DELETE_ALERT",
  ACKNOWLEDGE_ALERT: "ACKNOWLEDGE_ALERT",

  // Asset Management
  CREATE_ASSET: "CREATE_ASSET",
  UPDATE_ASSET: "UPDATE_ASSET",
  DELETE_ASSET: "DELETE_ASSET",

  // User Management
  CREATE_USER: "CREATE_USER",
  UPDATE_USER: "UPDATE_USER",
  DELETE_USER: "DELETE_USER",
  ASSIGN_ROLE: "ASSIGN_ROLE",
  REMOVE_ROLE: "REMOVE_ROLE",

  // Admin Operations
  CONFIG_CHANGE: "CONFIG_CHANGE",
  RETENTION_POLICY_CHANGE: "RETENTION_POLICY_CHANGE",
  EXPORT_REPORT: "EXPORT_REPORT",
  SYSTEM_OVERRIDE: "SYSTEM_OVERRIDE",
} as const;

export type AuditAction = typeof AuditActions[keyof typeof AuditActions];

export const RetentionPolicies = {
  security: 7 * 365, // 7 years in days
  operational: 2 * 365, // 2 years
  analytics: 365, // 1 year
};

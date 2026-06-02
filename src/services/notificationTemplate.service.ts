/**
 * Notification Template Service
 * Manages reusable notification templates for email, webhook, and in-app delivery
 */

import { getDatabase } from "../database/connection";
import { logger } from "../utils/logger";
import { randomBytes } from "crypto";

// ─── Types ───────────────────────────────────────────────────────────────────

export type TemplateChannel = "email" | "webhook" | "in_app" | "sms";
export type TemplateStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "archived";

export interface NotificationTemplate {
  id: string;
  name: string;
  description: string;
  channel: TemplateChannel;
  subject: string | null;
  body: string;
  variables: string[];
  metadata: Record<string, unknown>;
  status: TemplateStatus;
  version: number;
  created_by: string;
  approved_by: string | null;
  approved_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface TemplateVersion {
  id: string;
  template_id: string;
  version: number;
  subject: string | null;
  body: string;
  variables: string[];
  created_by: string;
  created_at: Date;
}

export interface TemplatePreview {
  subject: string | null;
  body: string;
  variables_used: string[];
  missing_variables: string[];
}

// ─── Notification Template Service ───────────────────────────────────────────

export class NotificationTemplateService {
  private readonly VARIABLE_PATTERN = /\{\{(\w+)\}\}/g;

  /**
   * Create template
   */
  async createTemplate(
    template: Omit<
      NotificationTemplate,
      | "id"
      | "status"
      | "version"
      | "approved_by"
      | "approved_at"
      | "created_at"
      | "updated_at"
    >,
  ): Promise<NotificationTemplate> {
    const db = getDatabase();

    try {
      const templateId = randomBytes(16).toString("hex");

      // Extract variables from body
      const variables = this.extractVariables(template.body);
      if (template.subject) {
        variables.push(...this.extractVariables(template.subject));
      }

      const newTemplate = {
        id: templateId,
        ...template,
        variables: JSON.stringify([...new Set(variables)]),
        metadata: JSON.stringify(template.metadata),
        status: "draft" as TemplateStatus,
        version: 1,
        approved_by: null,
        approved_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      await db("notification_templates").insert(newTemplate);

      // Create initial version
      await this.createVersion(
        templateId,
        1,
        template.subject,
        template.body,
        variables,
        template.created_by,
      );

      logger.info({ templateId, name: template.name }, "Template created");

      return {
        ...newTemplate,
        variables: [...new Set(variables)],
        metadata: template.metadata,
      };
    } catch (error) {
      logger.error({ error }, "Failed to create template");
      throw error;
    }
  }

  /**
   * Get template
   */
  async getTemplate(templateId: string): Promise<NotificationTemplate | null> {
    const db = getDatabase();

    try {
      const template = await db("notification_templates")
        .where({ id: templateId })
        .first();

      if (!template) {
        return null;
      }

      return {
        ...template,
        variables: JSON.parse(template.variables || "[]"),
        metadata: JSON.parse(template.metadata || "{}"),
      };
    } catch (error) {
      logger.error({ error, templateId }, "Failed to get template");
      return null;
    }
  }

  /**
   * Update template
   */
  async updateTemplate(
    templateId: string,
    updates: Partial<
      Pick<
        NotificationTemplate,
        "name" | "description" | "subject" | "body" | "metadata"
      >
    >,
    updatedBy: string,
  ): Promise<NotificationTemplate | null> {
    const db = getDatabase();

    try {
      const existing = await this.getTemplate(templateId);
      if (!existing) {
        return null;
      }

      // Extract new variables if body or subject changed
      let variables = existing.variables;
      if (updates.body || updates.subject) {
        const newVars: string[] = [];
        if (updates.body) {
          newVars.push(...this.extractVariables(updates.body));
        }
        if (updates.subject) {
          newVars.push(...this.extractVariables(updates.subject));
        }
        variables = [...new Set([...existing.variables, ...newVars])];
      }

      const updateData: any = {
        ...updates,
        variables: JSON.stringify(variables),
        version: existing.version + 1,
        status: "draft", // Reset to draft on update
        updated_at: new Date(),
      };

      if (updates.metadata) {
        updateData.metadata = JSON.stringify(updates.metadata);
      }

      await db("notification_templates")
        .where({ id: templateId })
        .update(updateData);

      // Create new version
      await this.createVersion(
        templateId,
        existing.version + 1,
        updates.subject || existing.subject,
        updates.body || existing.body,
        variables,
        updatedBy,
      );

      logger.info({ templateId }, "Template updated");

      return await this.getTemplate(templateId);
    } catch (error) {
      logger.error({ error, templateId }, "Failed to update template");
      throw error;
    }
  }

  /**
   * Submit template for approval
   */
  async submitForApproval(templateId: string): Promise<void> {
    const db = getDatabase();

    try {
      await db("notification_templates").where({ id: templateId }).update({
        status: "pending_approval",
        updated_at: new Date(),
      });

      logger.info({ templateId }, "Template submitted for approval");
    } catch (error) {
      logger.error({ error, templateId }, "Failed to submit template");
      throw error;
    }
  }

  /**
   * Approve template
   */
  async approveTemplate(templateId: string, approvedBy: string): Promise<void> {
    const db = getDatabase();

    try {
      await db("notification_templates").where({ id: templateId }).update({
        status: "approved",
        approved_by: approvedBy,
        approved_at: new Date(),
        updated_at: new Date(),
      });

      logger.info({ templateId, approvedBy }, "Template approved");
    } catch (error) {
      logger.error({ error, templateId }, "Failed to approve template");
      throw error;
    }
  }

  /**
   * Archive template
   */
  async archiveTemplate(templateId: string): Promise<void> {
    const db = getDatabase();

    try {
      await db("notification_templates").where({ id: templateId }).update({
        status: "archived",
        updated_at: new Date(),
      });

      logger.info({ templateId }, "Template archived");
    } catch (error) {
      logger.error({ error, templateId }, "Failed to archive template");
      throw error;
    }
  }

  /**
   * Preview template with variables
   */
  async previewTemplate(
    templateId: string,
    variables: Record<string, string>,
  ): Promise<TemplatePreview> {
    try {
      const template = await this.getTemplate(templateId);
      if (!template) {
        throw new Error("Template not found");
      }

      const renderedBody = this.renderTemplate(template.body, variables);
      const renderedSubject = template.subject
        ? this.renderTemplate(template.subject, variables)
        : null;

      const variablesUsed = template.variables;
      const missingVariables = variablesUsed.filter((v) => !(v in variables));

      return {
        subject: renderedSubject,
        body: renderedBody,
        variables_used: variablesUsed,
        missing_variables: missingVariables,
      };
    } catch (error) {
      logger.error({ error, templateId }, "Failed to preview template");
      throw error;
    }
  }

  /**
   * Validate template variables
   */
  validateVariables(
    templateBody: string,
    templateSubject: string | null,
    providedVariables: string[],
  ): { valid: boolean; missing: string[]; unused: string[] } {
    const requiredVars = this.extractVariables(templateBody);
    if (templateSubject) {
      requiredVars.push(...this.extractVariables(templateSubject));
    }

    const uniqueRequired = [...new Set(requiredVars)];
    const missing = uniqueRequired.filter(
      (v) => !providedVariables.includes(v),
    );
    const unused = providedVariables.filter((v) => !uniqueRequired.includes(v));

    return {
      valid: missing.length === 0,
      missing,
      unused,
    };
  }

  /**
   * Get all templates
   */
  async getAllTemplates(filters?: {
    channel?: TemplateChannel;
    status?: TemplateStatus;
  }): Promise<NotificationTemplate[]> {
    const db = getDatabase();

    try {
      let query = db("notification_templates");

      if (filters?.channel) {
        query = query.where("channel", filters.channel);
      }
      if (filters?.status) {
        query = query.where("status", filters.status);
      }

      const templates = await query.orderBy("created_at", "desc");

      return templates.map((t: any) => ({
        ...t,
        variables: JSON.parse(t.variables || "[]"),
        metadata: JSON.parse(t.metadata || "{}"),
      }));
    } catch (error) {
      logger.error({ error }, "Failed to get all templates");
      return [];
    }
  }

  /**
   * Get template versions
   */
  async getTemplateVersions(templateId: string): Promise<TemplateVersion[]> {
    const db = getDatabase();

    try {
      const versions = await db("template_versions")
        .where({ template_id: templateId })
        .orderBy("version", "desc");

      return versions.map((v: any) => ({
        ...v,
        variables: JSON.parse(v.variables || "[]"),
      }));
    } catch (error) {
      logger.error({ error, templateId }, "Failed to get template versions");
      return [];
    }
  }

  /**
   * Render template with variables
   */
  private renderTemplate(
    template: string,
    variables: Record<string, string>,
  ): string {
    return template.replace(this.VARIABLE_PATTERN, (match, varName) => {
      return variables[varName] || match;
    });
  }

  /**
   * Extract variables from template
   */
  private extractVariables(template: string): string[] {
    const matches = template.matchAll(this.VARIABLE_PATTERN);
    return Array.from(matches, (m) => m[1]);
  }

  /**
   * Create template version
   */
  private async createVersion(
    templateId: string,
    version: number,
    subject: string | null,
    body: string,
    variables: string[],
    createdBy: string,
  ): Promise<void> {
    const db = getDatabase();

    try {
      await db("template_versions").insert({
        id: randomBytes(16).toString("hex"),
        template_id: templateId,
        version,
        subject,
        body,
        variables: JSON.stringify(variables),
        created_by: createdBy,
        created_at: new Date(),
      });
    } catch (error) {
      logger.error({ error, templateId, version }, "Failed to create version");
    }
  }
}

// ─── Singleton Instance ──────────────────────────────────────────────────────

export const notificationTemplateService = new NotificationTemplateService();

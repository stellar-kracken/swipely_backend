import crypto from "crypto";
import { getDatabase } from "../database/connection.js";
import { logger } from "../utils/logger.js";

export interface ServiceAnnotation {
  id: string;
  serviceName: string;
  entityType: string;
  entityId: string | null;
  content: string;
  author: string;
  startTime: Date | null;
  endTime: Date | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAnnotationInput {
  serviceName: string;
  entityType: string;
  entityId?: string;
  content: string;
  author: string;
  startTime?: Date;
  endTime?: Date;
}

export interface UpdateAnnotationInput {
  content?: string;
  startTime?: Date | null;
  endTime?: Date | null;
  active?: boolean;
}

export class ServiceAnnotationService {
  private static instance: ServiceAnnotationService;

  private constructor() {}

  public static getInstance(): ServiceAnnotationService {
    if (!ServiceAnnotationService.instance) {
      ServiceAnnotationService.instance = new ServiceAnnotationService();
    }
    return ServiceAnnotationService.instance;
  }

  public async create(input: CreateAnnotationInput): Promise<ServiceAnnotation> {
    const db = getDatabase();
    const id = crypto.randomUUID();

    const [row] = await db("service_annotations")
      .insert({
        id,
        service_name: input.serviceName,
        entity_type: input.entityType,
        entity_id: input.entityId ?? null,
        content: input.content,
        author: input.author,
        start_time: input.startTime ?? null,
        end_time: input.endTime ?? null,
        active: true,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning("*");

    await this.logAudit(id, "created", input.author, { input });
    logger.info({ id, serviceName: input.serviceName }, "Service annotation created");
    return this.mapRow(row);
  }

  public async get(id: string): Promise<ServiceAnnotation | null> {
    const db = getDatabase();
    const row = await db("service_annotations").where("id", id).first();
    return row ? this.mapRow(row) : null;
  }

  public async update(
    id: string,
    actor: string,
    updates: UpdateAnnotationInput
  ): Promise<ServiceAnnotation | null> {
    const db = getDatabase();
    const existing = await db("service_annotations").where("id", id).first();
    if (!existing) return null;

    const updateData: Record<string, unknown> = { updated_at: new Date() };
    if (updates.content !== undefined) updateData.content = updates.content;
    if (updates.active !== undefined) updateData.active = updates.active;
    if ("startTime" in updates) updateData.start_time = updates.startTime ?? null;
    if ("endTime" in updates) updateData.end_time = updates.endTime ?? null;

    const [row] = await db("service_annotations")
      .where("id", id)
      .update(updateData)
      .returning("*");

    await this.logAudit(id, "updated", actor, { updates });
    logger.info({ id }, "Service annotation updated");
    return this.mapRow(row);
  }

  public async delete(id: string, actor: string): Promise<boolean> {
    const db = getDatabase();
    const count = await db("service_annotations").where("id", id).delete();
    if (count > 0) {
      await this.logAudit(id, "deleted", actor, {});
      logger.info({ id }, "Service annotation deleted");
    }
    return count > 0;
  }

  public async list(params: {
    serviceName?: string;
    entityType?: string;
    entityId?: string;
    active?: boolean;
    author?: string;
  } = {}): Promise<ServiceAnnotation[]> {
    const db = getDatabase();
    let query = db("service_annotations").orderBy("created_at", "desc");

    if (params.serviceName) query = query.where("service_name", params.serviceName);
    if (params.entityType) query = query.where("entity_type", params.entityType);
    if (params.entityId) query = query.where("entity_id", params.entityId);
    if (params.active !== undefined) query = query.where("active", params.active);
    if (params.author) query = query.where("author", params.author);

    const rows = await query;
    return rows.map((r: Record<string, unknown>) => this.mapRow(r));
  }

  public async getAuditLog(annotationId: string): Promise<Record<string, unknown>[]> {
    const db = getDatabase();
    return db("service_annotation_audit")
      .where("annotation_id", annotationId)
      .orderBy("created_at", "desc");
  }

  private async logAudit(
    annotationId: string,
    action: string,
    actor: string,
    changes: Record<string, unknown>
  ): Promise<void> {
    const db = getDatabase();
    await db("service_annotation_audit").insert({
      id: crypto.randomUUID(),
      annotation_id: annotationId,
      action,
      actor,
      changes: JSON.stringify(changes),
      created_at: new Date(),
    });
  }

  private mapRow(row: Record<string, unknown>): ServiceAnnotation {
    return {
      id: row.id as string,
      serviceName: row.service_name as string,
      entityType: row.entity_type as string,
      entityId: (row.entity_id as string) ?? null,
      content: row.content as string,
      author: row.author as string,
      startTime: (row.start_time as Date) ?? null,
      endTime: (row.end_time as Date) ?? null,
      active: row.active as boolean,
      createdAt: row.created_at as Date,
      updatedAt: row.updated_at as Date,
    };
  }
}

export const serviceAnnotationService = ServiceAnnotationService.getInstance();

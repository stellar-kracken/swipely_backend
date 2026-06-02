import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { serviceAnnotationService } from "../../services/serviceAnnotation.service.js";

interface CreateBody {
  serviceName: string;
  entityType: string;
  entityId?: string;
  content: string;
  author: string;
  startTime?: string;
  endTime?: string;
}

interface UpdateBody {
  actor: string;
  content?: string;
  active?: boolean;
  startTime?: string | null;
  endTime?: string | null;
}

interface ListQuery {
  serviceName?: string;
  entityType?: string;
  entityId?: string;
  active?: string;
  author?: string;
}

interface Params {
  id: string;
}

export async function serviceAnnotationRoutes(server: FastifyInstance) {
  server.post<{ Body: CreateBody }>(
    "/",
    async (request: FastifyRequest<{ Body: CreateBody }>, reply: FastifyReply) => {
      try {
        const { serviceName, entityType, entityId, content, author, startTime, endTime } = request.body;
        const annotation = await serviceAnnotationService.create({
          serviceName,
          entityType,
          entityId,
          content,
          author,
          startTime: startTime ? new Date(startTime) : undefined,
          endTime: endTime ? new Date(endTime) : undefined,
        });
        return reply.code(201).send(annotation);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to create annotation";
        return reply.code(400).send({ error: message });
      }
    }
  );

  server.get<{ Params: Params }>(
    "/:id",
    async (request: FastifyRequest<{ Params: Params }>, reply: FastifyReply) => {
      const annotation = await serviceAnnotationService.get(request.params.id);
      if (!annotation) return reply.code(404).send({ error: "Annotation not found" });
      return annotation;
    }
  );

  server.patch<{ Params: Params; Body: UpdateBody }>(
    "/:id",
    async (request: FastifyRequest<{ Params: Params; Body: UpdateBody }>, reply: FastifyReply) => {
      try {
        const { actor, ...updates } = request.body;
        const updateInput: Record<string, unknown> = {};
        if (updates.content !== undefined) updateInput.content = updates.content;
        if (updates.active !== undefined) updateInput.active = updates.active;
        if ("startTime" in updates) updateInput.startTime = updates.startTime ? new Date(updates.startTime) : null;
        if ("endTime" in updates) updateInput.endTime = updates.endTime ? new Date(updates.endTime) : null;

        const annotation = await serviceAnnotationService.update(
          request.params.id,
          actor ?? "api",
          updateInput as any
        );
        if (!annotation) return reply.code(404).send({ error: "Annotation not found" });
        return annotation;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to update annotation";
        return reply.code(400).send({ error: message });
      }
    }
  );

  server.delete<{ Params: Params }>(
    "/:id",
    async (request: FastifyRequest<{ Params: Params }>, reply: FastifyReply) => {
      const actor = (request.headers["x-user"] as string) ?? "api";
      const deleted = await serviceAnnotationService.delete(request.params.id, actor);
      if (!deleted) return reply.code(404).send({ error: "Annotation not found" });
      return reply.code(204).send();
    }
  );

  server.get<{ Querystring: ListQuery }>(
    "/",
    async (request: FastifyRequest<{ Querystring: ListQuery }>) => {
      const { serviceName, entityType, entityId, active, author } = request.query;
      return serviceAnnotationService.list({
        serviceName,
        entityType,
        entityId,
        active: active !== undefined ? active === "true" : undefined,
        author,
      });
    }
  );

  server.get<{ Params: Params }>(
    "/:id/audit",
    async (request: FastifyRequest<{ Params: Params }>) => {
      return serviceAnnotationService.getAuditLog(request.params.id);
    }
  );
}

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { serviceAnnotationService } from "../../services/serviceAnnotation.service.js";

const ENTITY_TYPE = "contract";

interface CreateBody {
  content: string;
  author: string;
  startTime?: string;
  endTime?: string;
}

interface ContractParams {
  contractAddress: string;
}

interface ListQuery {
  active?: string;
  author?: string;
}

/**
 * Contract-scoped wrapper around the service annotation system.
 * Annotations are stored with entityType="contract" and entityId=<contractAddress>,
 * giving auditors and operators read access to context attached to a specific contract.
 */
export async function contractAnnotationRoutes(server: FastifyInstance) {
  server.post<{ Params: ContractParams; Body: CreateBody }>(
    "/:contractAddress/annotations",
    async (
      request: FastifyRequest<{ Params: ContractParams; Body: CreateBody }>,
      reply: FastifyReply
    ) => {
      try {
        const { contractAddress } = request.params;
        const { content, author, startTime, endTime } = request.body;
        const annotation = await serviceAnnotationService.create({
          serviceName: "contract",
          entityType: ENTITY_TYPE,
          entityId: contractAddress,
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

  server.get<{ Params: ContractParams; Querystring: ListQuery }>(
    "/:contractAddress/annotations",
    async (request: FastifyRequest<{ Params: ContractParams; Querystring: ListQuery }>) => {
      const { contractAddress } = request.params;
      const { active, author } = request.query;
      return serviceAnnotationService.list({
        entityType: ENTITY_TYPE,
        entityId: contractAddress,
        active: active !== undefined ? active === "true" : undefined,
        author,
      });
    }
  );
}

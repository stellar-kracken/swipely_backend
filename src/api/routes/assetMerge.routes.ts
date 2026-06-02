import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { assetMergeService } from "../../services/assetMerge.service.js";

interface MergeBody {
  primaryAssetId: string;
  duplicateIds: string[];
  triggeredBy: string;
}

interface ReviewBody {
  status: "approved" | "rejected";
  reviewedBy: string;
  reviewNotes?: string;
}

interface ReviewParams {
  id: string;
}

interface HistoryQuery {
  primaryAssetId?: string;
  limit?: string;
}

export async function assetMergeRoutes(server: FastifyInstance) {
  server.get(
    "/duplicates",
    async () => {
      const groups = await assetMergeService.findDuplicates();
      return { count: groups.length, groups };
    }
  );

  server.get(
    "/history",
    async (request: FastifyRequest<{ Querystring: HistoryQuery }>) => {
      const { primaryAssetId, limit } = request.query;
      return assetMergeService.getMergeHistory({
        primaryAssetId,
        limit: limit ? parseInt(limit, 10) : undefined,
      });
    }
  );

  server.post<{ Body: MergeBody }>(
    "/merge",
    async (request: FastifyRequest<{ Body: MergeBody }>, reply: FastifyReply) => {
      try {
        const { primaryAssetId, duplicateIds, triggeredBy } = request.body;
        const result = await assetMergeService.merge(primaryAssetId, duplicateIds, triggeredBy);
        return reply.code(200).send(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Merge failed";
        return reply.code(400).send({ error: message });
      }
    }
  );

  server.get(
    "/reviews",
    async (request: FastifyRequest<{ Querystring: { status?: string } }>) => {
      return assetMergeService.listReviews({ status: request.query.status });
    }
  );

  server.post<{ Body: { duplicateGroup: any } }>(
    "/reviews",
    async (request: FastifyRequest<{ Body: { duplicateGroup: any } }>, reply: FastifyReply) => {
      try {
        const review = await assetMergeService.proposeMerge(request.body.duplicateGroup);
        return reply.code(201).send(review);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to propose merge";
        return reply.code(400).send({ error: message });
      }
    }
  );

  server.get<{ Params: ReviewParams }>(
    "/reviews/:id",
    async (request: FastifyRequest<{ Params: ReviewParams }>, reply: FastifyReply) => {
      const review = await assetMergeService.getReview(request.params.id);
      if (!review) return reply.code(404).send({ error: "Review not found" });
      return review;
    }
  );

  server.patch<{ Params: ReviewParams; Body: ReviewBody }>(
    "/reviews/:id",
    async (request: FastifyRequest<{ Params: ReviewParams; Body: ReviewBody }>, reply: FastifyReply) => {
      try {
        const { status, reviewedBy, reviewNotes } = request.body;
        const review = await assetMergeService.reviewMerge(
          request.params.id,
          status,
          reviewedBy,
          reviewNotes
        );
        if (!review) return reply.code(404).send({ error: "Review not found" });
        return review;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to review merge";
        return reply.code(400).send({ error: message });
      }
    }
  );
}

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import "@fastify/rate-limit";
import { getCrossChainVerificationService } from "../../services/crossChainStateVerification.service.js";
import { logger } from "../../utils/logger.js";

export async function crossChainVerificationRoutes(server: FastifyInstance) {
  const svc = getCrossChainVerificationService();

  server.get(
    "/",
    {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rateLimit: { max: 30, timeWindow: "1 minute" },
      schema: {
        tags: ["Cross-Chain Verification"],
        summary: "Get state verification status for all active bridges",
        description:
          "Returns cached cross-chain state consistency results. Each result compares Ethereum locked reserves against Stellar supply and validates the latest Merkle commitment.",
        querystring: {
          type: "object",
          properties: {
            force: {
              type: "boolean",
              default: false,
              description: "Bypass cache and re-fetch from both chains",
            },
          },
        },
        response: {
          200: { type: "object", additionalProperties: true },
        },
      },
    } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    async (request: FastifyRequest<{ Querystring: { force?: boolean } }>) => {
      const { force } = request.query;
      const results = await svc.verifyAllBridges(force ?? false);
      return {
        count: results.length,
        verified: results.filter((r) => r.status === "verified").length,
        mismatches: results.filter((r) => r.status === "mismatch").length,
        errors: results.filter((r) => r.status === "error").length,
        results,
      };
    }
  );

  server.get<{ Params: { bridgeId: string }; Querystring: { force?: boolean } }>(
    "/:bridgeId",
    {
      rateLimit: { max: 60, timeWindow: "1 minute" },
      schema: {
        tags: ["Cross-Chain Verification"],
        summary: "Get cross-chain state verification for a specific bridge",
        params: {
          type: "object",
          properties: {
            bridgeId: { type: "string", description: "Bridge identifier" },
          },
          required: ["bridgeId"],
        },
        querystring: {
          type: "object",
          properties: {
            force: {
              type: "boolean",
              default: false,
              description: "Bypass cache and re-fetch from both chains",
            },
          },
        },
        response: {
          200: { type: "object", additionalProperties: true },
          404: { $ref: "Error#" },
          500: { $ref: "Error#" },
        },
      },
    } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    async (
      request: FastifyRequest<{ Params: { bridgeId: string }; Querystring: { force?: boolean } }>,
      reply: FastifyReply
    ) => {
      const { bridgeId } = request.params;
      const { force } = request.query;

      try {
        const result = await svc.verifyBridge(bridgeId, force ?? false);
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("No active bridge operator")) {
          return reply.status(404).send({ error: msg });
        }
        logger.error({ bridgeId, error: msg }, "Verification route error");
        return reply.status(500).send({ error: "Verification failed" });
      }
    }
  );

  server.post<{ Params: { bridgeId: string } }>(
    "/:bridgeId/verify",
    {
      rateLimit: { max: 10, timeWindow: "1 minute" },
      schema: {
        tags: ["Cross-Chain Verification"],
        summary: "Trigger an immediate cross-chain state verification",
        description:
          "Forces a fresh state fetch from both chains and re-validates Merkle proof consistency. Results are cached for 5 minutes.",
        params: {
          type: "object",
          properties: {
            bridgeId: { type: "string", description: "Bridge identifier" },
          },
          required: ["bridgeId"],
        },
        response: {
          200: { type: "object", additionalProperties: true },
          404: { $ref: "Error#" },
        },
      },
    } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    async (request: FastifyRequest<{ Params: { bridgeId: string } }>, reply: FastifyReply) => {
      const { bridgeId } = request.params;

      try {
        const result = await svc.verifyBridge(bridgeId, true);
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("No active bridge operator")) {
          return reply.status(404).send({ error: msg });
        }
        logger.error({ bridgeId, error: msg }, "Manual verification trigger failed");
        return reply.status(500).send({ error: "Verification failed" });
      }
    }
  );

  server.post<{
    Params: { bridgeId: string };
    Body: {
      sequence: number;
      proof: { leafHash: string; proofPath: string[]; leafIndex: number };
    };
  }>(
    "/:bridgeId/verify-proof",
    {
      rateLimit: { max: 10, timeWindow: "1 minute" },
      schema: {
        tags: ["Cross-Chain Verification"],
        summary: "Validate a Merkle proof against an on-chain commitment",
        description:
          "Submits a Merkle proof for simulation against the Soroban bridge reserve verifier contract. Returns true if the proof is valid for the given sequence.",
        params: {
          type: "object",
          properties: {
            bridgeId: { type: "string" },
          },
          required: ["bridgeId"],
        },
        body: {
          type: "object",
          properties: {
            sequence: { type: "number", description: "Commitment sequence number" },
            proof: {
              type: "object",
              properties: {
                leafHash: { type: "string", description: "Hex-encoded 32-byte leaf hash" },
                proofPath: {
                  type: "array",
                  items: { type: "string" },
                  description: "Hex-encoded sibling hashes along the Merkle path",
                },
                leafIndex: { type: "number", description: "Zero-based index of the leaf" },
              },
              required: ["leafHash", "proofPath", "leafIndex"],
            },
          },
          required: ["sequence", "proof"],
        },
        response: {
          200: {
            type: "object",
            properties: {
              bridgeId: { type: "string" },
              sequence: { type: "number" },
              valid: { type: "boolean" },
            },
          },
        },
      },
    } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    async (
      request: FastifyRequest<{
        Params: { bridgeId: string };
        Body: {
          sequence: number;
          proof: { leafHash: string; proofPath: string[]; leafIndex: number };
        };
      }>
    ) => {
      const { bridgeId } = request.params;
      const { sequence, proof } = request.body;

      const valid = await svc.verifyMerkleProof({ bridgeId, sequence, proof });
      return { bridgeId, sequence, valid };
    }
  );

  server.get<{ Params: { bridgeId: string }; Querystring: { limit?: number } }>(
    "/:bridgeId/history",
    {
      rateLimit: { max: 30, timeWindow: "1 minute" },
      schema: {
        tags: ["Cross-Chain Verification"],
        summary: "Fetch verification history for a bridge",
        params: {
          type: "object",
          properties: { bridgeId: { type: "string" } },
          required: ["bridgeId"],
        },
        querystring: {
          type: "object",
          properties: {
            limit: { type: "number", default: 20, maximum: 100 },
          },
        },
        response: {
          200: { type: "array", items: { type: "object", additionalProperties: true } },
        },
      },
    } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    async (request: FastifyRequest<{ Params: { bridgeId: string }; Querystring: { limit?: number } }>) => {
      const { bridgeId } = request.params;
      const { limit } = request.query;
      return svc.getVerificationHistory(bridgeId, limit ?? 20);
    }
  );
}

import type { FastifyRequest, FastifyReply } from "fastify";

/**
 * API key authentication middleware.
 * For public endpoints this is optional; for admin endpoints it is required.
 */
export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const apiKey = request.headers["x-api-key"];

  if (!apiKey) {
    return reply.status(401).send({
      error: "Unauthorized",
      message: "Missing API key. Provide it via the x-api-key header.",
    });
  }

  // TODO: Validate API key against database or config
  // For now, this is a placeholder for future API key validation
}

import { FastifyInstance } from "fastify";
import { riskController } from "./risk.controller.js";

export async function riskRoutes(fastify: FastifyInstance) {
  fastify.register(riskController, { prefix: "/api/v1/risk" });
}

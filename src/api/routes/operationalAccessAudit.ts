import type { FastifyInstance } from "fastify";
import { getDatabase } from "../../database/connection.js";

export async function operationalAccessAuditRoutes(server: FastifyInstance) {
  server.get("/entries", {
    schema: {
      tags: ["Admin"],
      summary: "List operational access audit log entries",
      querystring: {
        type: "object",
        properties: {
          page: { type: "integer", minimum: 1, default: 1 },
          limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
          role: { type: "string" },
          action: { type: "string" },
        },
      },
      response: { 200: { type: "object", additionalProperties: true } },
    },
  }, async (request) => {
    const { page = 1, limit = 50, role, action } = request.query as Record<string, any>;
    const offset = (page - 1) * limit;

    let query = getDatabase()("audit_logs").orderBy("created_at", "desc").limit(limit).offset(offset);
    if (role) query = query.where("role", role);
    if (action) query = query.where("action", action);

    const [entries, [{ count }]] = await Promise.all([
      query,
      getDatabase()("audit_logs").count("* as count"),
    ]);

    return { entries, total: Number(count), page, limit };
  });

  server.get("/stats", {
    schema: {
      tags: ["Admin"],
      summary: "Aggregated access audit statistics",
      response: { 200: { type: "object", additionalProperties: true } },
    },
  }, async () => {
    const [total, byRole, byAction] = await Promise.all([
      getDatabase()("audit_logs").count("* as count").first(),
      getDatabase()("audit_logs").select("role").count("* as count").groupBy("role").orderBy("count", "desc"),
      getDatabase()("audit_logs").select("action").count("* as count").groupBy("action").orderBy("count", "desc"),
    ]);

    return {
      total: Number(total?.count ?? 0),
      byRole,
      byAction,
    };
  });

  server.get("/roles", {
    schema: {
      tags: ["Admin"],
      summary: "List admin role assignments",
      response: { 200: { type: "object", additionalProperties: true } },
    },
  }, async () => {
    const members = await getDatabase()("role_assignments")
      .select("*")
      .orderBy("assigned_at", "desc");

    return { members };
  });

  server.get("/sessions", {
    schema: {
      tags: ["Admin"],
      summary: "List admin sessions",
      querystring: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["active", "expired", "revoked", "all"], default: "all" },
        },
      },
      response: { 200: { type: "object", additionalProperties: true } },
    },
  }, async (request) => {
    const { status = "all" } = request.query as Record<string, any>;

    let query = getDatabase()("admin_sessions").select("*").orderBy("created_at", "desc");
    if (status !== "all") query = query.where("status", status);

    const sessions = await query;
    return { sessions };
  });

  server.get("/export", {
    schema: {
      tags: ["Admin"],
      summary: "Export audit log as CSV",
      headers: {
        type: "object",
        properties: { "x-api-key": { type: "string" } },
        required: ["x-api-key"],
      },
      response: { 200: { type: "string" } },
    },
  }, async (request, reply) => {
    const apiKey = (request.headers as Record<string, string>)["x-api-key"];
    if (!apiKey || apiKey !== process.env.ADMIN_EXPORT_API_KEY) {
      reply.statusCode = 401;
      return { error: "Unauthorized" };
    }

    const entries = await getDatabase()("audit_logs").select("*").orderBy("created_at", "desc").limit(10000);

    const header = "id,action,role,actor,target,created_at\n";
    const rows = entries
      .map((e: Record<string, any>) =>
        [e.id, e.action, e.role, e.actor, e.target, e.created_at]
          .map((v) => JSON.stringify(v ?? ""))
          .join(",")
      )
      .join("\n");

    reply.header("Content-Type", "text/csv");
    reply.header("Content-Disposition", "attachment; filename=access-audit.csv");
    return header + rows;
  });
}

import type { FastifyInstance } from "fastify";
import { authMiddleware } from "../middleware/auth.js";
import { AdminRotationService, AdminRole, ProposalType } from "../../services/adminRotation.service.js";

interface AddAdminBody {
  address: string;
  name: string;
  email?: string;
  roles: AdminRole[];
  reason?: string;
}

interface RemoveAdminBody {
  reason?: string;
}

interface ChangeRolesBody {
  roles: AdminRole[];
  reason?: string;
}

interface CreateProposalBody {
  proposalType: ProposalType;
  targetAddress: string;
  proposedChanges: Record<string, unknown>;
  requiredApprovals?: number;
  expiresInHours?: number;
}

interface ApproveProposalBody {
  approverAddress: string;
}

interface RejectProposalBody {
  rejectorAddress: string;
  reason: string;
}

interface ExecuteProposalBody {
  executorAddress: string;
}

export async function adminRotationRoutes(server: FastifyInstance) {
  const adminRotationService = AdminRotationService.getInstance();
  const requireAdmin = authMiddleware({ requiredScopes: ["admin", "super_admin"] });

  // List all admins
  server.get("/admins", { preHandler: requireAdmin }, async (request) => {
    const activeOnly = request.query && (request.query as any).activeOnly === "true";
    const admins = await adminRotationService.listAdmins(activeOnly);
    return { admins };
  });

  // Get admin by address
  server.get<{ Params: { address: string } }>(
    "/admins/:address",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const admin = await adminRotationService.getAdminByAddress(request.params.address);
      if (!admin) {
        return reply.code(404).send({
          error: "Not Found",
          message: "Admin account not found",
        });
      }
      return { admin };
    }
  );

  // Add new admin
  server.post<{ Body: AddAdminBody }>(
    "/admins",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { address, name, email, roles, reason } = request.body;

      if (!address?.trim() || !name?.trim()) {
        return reply.code(400).send({
          error: "Bad Request",
          message: "Address and name are required",
        });
      }

      if (!roles || roles.length === 0) {
        return reply.code(400).send({
          error: "Bad Request",
          message: "At least one role is required",
        });
      }

      try {
        const admin = await adminRotationService.addAdmin({
          address,
          name,
          email,
          roles,
          addedBy: request.apiKeyAuth?.name ?? "system",
          reason,
        });

        return reply.code(201).send({ admin });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to add admin";
        return reply.code(400).send({
          error: "Bad Request",
          message,
        });
      }
    }
  );

  // Remove admin (deactivate)
  server.delete<{ Params: { address: string }; Body: RemoveAdminBody }>(
    "/admins/:address",
    { preHandler: requireAdmin },
    async (request, reply) => {
      try {
        const admin = await adminRotationService.removeAdmin({
          address: request.params.address,
          removedBy: request.apiKeyAuth?.name ?? "system",
          reason: request.body?.reason,
        });

        return { admin };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to remove admin";
        return reply.code(400).send({
          error: "Bad Request",
          message,
        });
      }
    }
  );

  // Change admin roles
  server.patch<{ Params: { address: string }; Body: ChangeRolesBody }>(
    "/admins/:address/roles",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { roles, reason } = request.body;

      if (!roles || roles.length === 0) {
        return reply.code(400).send({
          error: "Bad Request",
          message: "At least one role is required",
        });
      }

      try {
        const admin = await adminRotationService.changeRoles({
          address: request.params.address,
          newRoles: roles,
          changedBy: request.apiKeyAuth?.name ?? "system",
          reason,
        });

        return { admin };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to change roles";
        return reply.code(400).send({
          error: "Bad Request",
          message,
        });
      }
    }
  );

  // Activate admin
  server.post<{ Params: { address: string } }>(
    "/admins/:address/activate",
    { preHandler: requireAdmin },
    async (request, reply) => {
      try {
        const admin = await adminRotationService.activateAdmin(
          request.params.address,
          request.apiKeyAuth?.name ?? "system"
        );

        return { admin };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to activate admin";
        return reply.code(400).send({
          error: "Bad Request",
          message,
        });
      }
    }
  );

  // Get rotation events
  server.get("/events", { preHandler: requireAdmin }, async (request) => {
    const adminAddress = request.query && (request.query as any).adminAddress;
    const limit = request.query && (request.query as any).limit ? parseInt((request.query as any).limit, 10) : 100;
    const events = await adminRotationService.getRotationEvents(adminAddress, limit);
    return { events };
  });

  // Get active admin count
  server.get("/admins/stats/count", { preHandler: requireAdmin }, async () => {
    const count = await adminRotationService.getActiveAdminCount();
    return { activeAdminCount: count };
  });

  // -------------------------------------------------------------------------
  // PROPOSAL SYSTEM (Multi-sig workflow)
  // -------------------------------------------------------------------------

  // List proposals
  server.get("/proposals", { preHandler: requireAdmin }, async (request) => {
    const status = request.query && (request.query as any).status;
    const proposals = await adminRotationService.listProposals(status);
    return { proposals };
  });

  // Get proposal by ID
  server.get<{ Params: { id: string } }>(
    "/proposals/:id",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const proposal = await adminRotationService.getProposalById(request.params.id);
      if (!proposal) {
        return reply.code(404).send({
          error: "Not Found",
          message: "Proposal not found",
        });
      }
      return { proposal };
    }
  );

  // Create proposal
  server.post<{ Body: CreateProposalBody }>(
    "/proposals",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { proposalType, targetAddress, proposedChanges, requiredApprovals, expiresInHours } = request.body;

      if (!proposalType || !targetAddress || !proposedChanges) {
        return reply.code(400).send({
          error: "Bad Request",
          message: "proposalType, targetAddress, and proposedChanges are required",
        });
      }

      try {
        const proposal = await adminRotationService.createProposal({
          proposalType,
          targetAddress,
          proposedBy: request.apiKeyAuth?.name ?? "system",
          proposedChanges,
          requiredApprovals,
          expiresInHours,
        });

        return reply.code(201).send({ proposal });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to create proposal";
        return reply.code(400).send({
          error: "Bad Request",
          message,
        });
      }
    }
  );

  // Approve proposal
  server.post<{ Params: { id: string }; Body: ApproveProposalBody }>(
    "/proposals/:id/approve",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { approverAddress } = request.body;

      if (!approverAddress) {
        return reply.code(400).send({
          error: "Bad Request",
          message: "approverAddress is required",
        });
      }

      try {
        const proposal = await adminRotationService.approveProposal(
          request.params.id,
          approverAddress
        );

        return { proposal };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to approve proposal";
        return reply.code(400).send({
          error: "Bad Request",
          message,
        });
      }
    }
  );

  // Reject proposal
  server.post<{ Params: { id: string }; Body: RejectProposalBody }>(
    "/proposals/:id/reject",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { rejectorAddress, reason } = request.body;

      if (!rejectorAddress || !reason) {
        return reply.code(400).send({
          error: "Bad Request",
          message: "rejectorAddress and reason are required",
        });
      }

      try {
        const proposal = await adminRotationService.rejectProposal(
          request.params.id,
          rejectorAddress,
          reason
        );

        return { proposal };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to reject proposal";
        return reply.code(400).send({
          error: "Bad Request",
          message,
        });
      }
    }
  );

  // Execute proposal
  server.post<{ Params: { id: string }; Body: ExecuteProposalBody }>(
    "/proposals/:id/execute",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { executorAddress } = request.body;

      if (!executorAddress) {
        return reply.code(400).send({
          error: "Bad Request",
          message: "executorAddress is required",
        });
      }

      try {
        await adminRotationService.executeProposal(request.params.id, executorAddress);

        return { success: true, message: "Proposal executed successfully" };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to execute proposal";
        return reply.code(400).send({
          error: "Bad Request",
          message,
        });
      }
    }
  );
}

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { formatZodError, sanitizeObject } from "../../utils/validation.js";
import { validationService, type ValidationContext } from "../../services/validation.service.js";
import { createChildLogger } from "../../utils/logger.js";
import { config } from "../../config/index.js";

const validationLogger = createChildLogger('validation-middleware');

interface ValidationSchema {
  body?: z.ZodSchema;
  query?: z.ZodSchema;
  params?: z.ZodSchema;
}

/**
 * Enhanced validation middleware for Fastify
 * Validates body, query, and params, and applies sanitization
 */
export function validateRequest(schemas: ValidationSchema) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // 1. Validate Params
      if (schemas.params) {
        const result = schemas.params.safeParse(request.params);
        if (!result.success) {
          return reply.status(400).send({
            success: false,
            error: "Path Validation Failed",
            details: formatZodError(result.error),
          });
        }
        request.params = result.data;
      }

      // 2. Validate Query
      if (schemas.query) {
        const result = schemas.query.safeParse(request.query);
        if (!result.success) {
          return reply.status(400).send({
            success: false,
            error: "Query Validation Failed",
            details: formatZodError(result.error),
          });
        }
        request.query = result.data;
      }

      // 3. Validate Body
      if (schemas.body && request.body) {
        const result = schemas.body.safeParse(request.body);
        if (!result.success) {
          return reply.status(400).send({
            success: false,
            error: "Body Validation Failed",
            details: formatZodError(result.error),
          });
        }
        request.body = sanitizeObject(result.data);
      }

      validationLogger.debug({
        url: request.url,
        method: request.method,
      }, "Request validation successful");

    } catch (error) {
      validationLogger.error({ err: error, url: request.url }, "Validation middleware error");
      return reply.status(500).send({
        success: false,
        error: "Internal Validation Error",
      });
    }
  };
}

// Keep existing functionality for backward compatibility
// ... (rest of the file remains but I will keep only what's needed or refactor)

// Data type mapping for routes
const routeDataTypes: Record<string, string> = {
  '/api/v1/assets': 'asset',
  '/api/v1/bridges': 'bridge',
  '/api/v1/alert-rules': 'alertRule',
};

/**
 * Get data type from route path
 */
function getDataTypeFromPath(path: string): string | undefined {
  for (const [routePrefix, dataType] of Object.entries(routeDataTypes)) {
    if (path.startsWith(routePrefix)) {
      return dataType;
    }
  }
  return undefined;
}

/**
 * Check if user is admin based on API key
 */
function isAdmin(request: FastifyRequest): boolean {
  const apiKey = request.headers['x-api-key'] as string;
  return !!apiKey && apiKey.startsWith(config.RATE_LIMIT_ADMIN_API_KEY_PREFIX);
}

/**
 * Register validation middleware
 * Legacy global hook
 */
export async function registerValidation(server: FastifyInstance): Promise<void> {
  server.addHook('preValidation', async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') {
      return;
    }

    if ((request as any).skipValidation) {
      return;
    }

    const dataType = getDataTypeFromPath(request.url);
    if (!dataType) return;
    if (!request.body) return;

    const startTime = Date.now();

    try {
      const context: ValidationContext = {
        dataType,
        operation: request.method === 'POST' ? 'create' : 'update',
        isAdmin: isAdmin(request),
        correlationId: request.headers['x-correlation-id'] as string,
      };

      const result = await validationService.validate(
        request.body,
        dataType as any,
        context
      );

      (request as any).validationResult = result;

      if (!result.isValid && !result.metadata.bypassUsed) {
        return reply.status(400).send({
          success: false,
          error: 'Validation Failed',
          message: 'Request data failed validation',
          details: {
            errors: result.errors,
            warnings: result.warnings,
            dataType,
          },
        });
      }

      if (result.normalizedData) {
        request.body = sanitizeObject(result.normalizedData);
      }

    } catch (error) {
      validationLogger.error({ err: error, url: request.url }, 'Validation middleware error');
    }
  });

  validationLogger.info('Validation middleware registered');
}

export function skipValidation() {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    descriptor.value = async function (request: FastifyRequest, reply: FastifyReply, ...args: any[]) {
      (request as any).skipValidation = true;
      return originalMethod.apply(this, [request, reply, ...args]);
    };
    return descriptor;
  };
}

export function getValidationResult(request: FastifyRequest) {
  return (request as any).validationResult;
}

/**
 * Get normalized body from request
 */
export function getNormalizedBody(request: FastifyRequest) {
  return (request as any).normalizedBody || request.body;
}

/**
 * Helper to create validation middleware for specific data types
 */
export function createValidationMiddleware(dataType: string, options: ValidationOptions = {}) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (options.skipMethods?.includes(request.method)) {
      return;
    }

    if (!request.body) {
      return;
    }

    const context: ValidationContext = {
      dataType,
      operation: request.method === 'POST' ? 'create' : 'update',
      isAdmin: isAdmin(request),
      correlationId: request.headers['x-correlation-id'] as string,
    };

    const result = await validationService.validate(
      request.body,
      dataType as any,
      context
    );

    (request as any).validationResult = result;

    if (!result.isValid && !result.metadata.bypassUsed && !options.allowInvalid) {
      return reply.status(400).send({
        success: false,
        error: 'Validation Failed',
        message: 'Request data failed validation',
        details: {
          errors: result.errors,
          warnings: result.warnings,
          dataType,
        },
        timestamp: new Date().toISOString(),
      });
    }

    if (result.normalizedData && options.useNormalizedData !== false) {
      (request as any).normalizedBody = result.normalizedData;
    }
  };
}

interface ValidationOptions {
  skipMethods?: string[];
  allowInvalid?: boolean;
  useNormalizedData?: boolean;
}

/**
 * Batch validation helper for bulk operations
 */
export async function validateBatch(
  items: any[],
  dataType: string,
  request: FastifyRequest
): Promise<any> {
  const context: ValidationContext = {
    dataType,
    operation: 'batch',
    isAdmin: isAdmin(request),
    correlationId: request.headers['x-correlation-id'] as string,
  };

  const result = await validationService.validateBatch(
    items,
    dataType as any,
    context
  );

  return result;
}

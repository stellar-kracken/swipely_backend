import { z } from "zod";

/**
 * Basic XSS sanitization by escaping HTML special characters.
 */
export function sanitizeXSS(input: string): string {
    if (typeof input !== "string") return input;
    return input
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#x27;")
        .replace(/\//g, "&#x2F;");
}

/**
 * Deeply sanitize an object or array for XSS.
 */
export function sanitizeObject<T>(obj: T): T {
    if (!obj || typeof obj !== "object") {
        if (typeof obj === "string") return sanitizeXSS(obj) as any;
        return obj;
    }

    if (Array.isArray(obj)) {
        return obj.map(sanitizeObject) as any;
    }

    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
        sanitized[key] = sanitizeObject(value);
    }
    return sanitized;
}

/**
 * Prevent SQL injection for dynamic identifiers (like column names in ORDER BY).
 * Only allows alphanumeric characters and underscores.
 */
export function sanitizeSqlIdentifier(identifier: string): string {
    return identifier.replace(/[^a-zA-Z0-9_]/g, "");
}

/**
 * Type coercion helpers for Zod.
 */
export const coercion = {
    /**
     * Coerced boolean: "true", "1", true => true; anything else => false
     */
    boolean: z.preprocess((val) => {
        if (typeof val === "string") {
            if (val.toLowerCase() === "true" || val === "1") return true;
            if (val.toLowerCase() === "false" || val === "0") return false;
        }
        return val;
    }, z.boolean()),

    /**
     * Coerced number from string
     */
    number: z.preprocess((val) => {
        if (typeof val === "string") {
            const parsed = parseFloat(val);
            return isNaN(parsed) ? val : parsed;
        }
        return val;
    }, z.number()),

    /**
     * Coerced date from string
     */
    date: z.preprocess((val) => {
        if (typeof val === "string") return new Date(val);
        return val;
    }, z.date()),
};

/**
 * Validation error formatter.
 */
export function formatZodError(error: z.ZodError) {
    return error.errors.map((err) => ({
        path: err.path.join("."),
        message: err.message,
        code: err.code,
    }));
}

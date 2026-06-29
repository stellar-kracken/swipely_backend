import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    EmailNotificationService,
    type EmailRecipient,
    type EmailAlertPayload,
    type EmailDigestPayload,
} from "../../src/services/email.service.js";

const mocks = vi.hoisted(() => ({
    sendMail: vi.fn().mockResolvedValue({ messageId: "msg-1" }),
    verify: vi.fn().mockResolvedValue(true),
}));

vi.mock("nodemailer", () => ({
    default: {
        createTransport: vi.fn(() => ({
            sendMail: mocks.sendMail,
            verify: mocks.verify,
        })),
    },
}));

// All three SMTP values must be present to pass the getTransporter() guard:
// if (!config.SMTP_HOST || !config.SMTP_USER || !config.SMTP_PASSWORD) return null
vi.mock("../../src/config/index.js", () => ({
    config: {
        SMTP_HOST: "smtp.test.example",
        SMTP_PORT: 587,
        SMTP_SECURE: false,
        SMTP_USER: "user@test.example",
        SMTP_PASSWORD: "secret",
        SMTP_FROM_ADDRESS: "noreply@bridgewatch.io",
        SMTP_FROM_NAME: "Bridge Watch",
    },
}));

vi.mock("../../src/utils/logger.js", () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

const recipient: EmailRecipient = { email: "alice@example.com", name: "Alice" };

const alertPayload: EmailAlertPayload = {
    alertType: "depeg",
    severity: "high",
    assetCode: "USDC",
    message: "Price deviation detected",
    triggeredAt: "2024-06-01T00:00:00Z",
};

const digestPayload: EmailDigestPayload = {
    periodLabel: "Daily",
    generatedAt: "2024-06-01T00:00:00Z",
    items: [
        {
            title: "Alert summary",
            summary: "1 alert triggered",
            timestamp: "2024-06-01",
        },
    ],
};

// Use a high rate limit so the rate limiter never interferes with tests
function makeService() {
    return new EmailNotificationService({ maxPerMinute: 1000 });
}

describe("EmailNotificationService", () => {
    beforeEach(() => {
        mocks.sendMail.mockReset();
        mocks.verify.mockReset();
        mocks.sendMail.mockResolvedValue({ messageId: "msg-1" });
        mocks.verify.mockResolvedValue(true);
    });

    describe("sendAlertEmail", () => {
        it("enqueues and delivers alert email", async () => {
            const service = makeService();
            const id = await service.sendAlertEmail(recipient, alertPayload);

            expect(mocks.sendMail).toHaveBeenCalledOnce();
            expect(service.getDeliveryStatus(id)?.status).toBe("sent");
        });

        it("returns a non-empty string id", async () => {
            const service = makeService();
            const id = await service.sendAlertEmail(recipient, alertPayload);

            expect(typeof id).toBe("string");
            expect(id).toMatch(/^email_/);
        });

        it("sets deliveredAt after successful send", async () => {
            const service = makeService();
            const id = await service.sendAlertEmail(recipient, alertPayload);
            const status = service.getDeliveryStatus(id);

            expect(status?.deliveredAt).toBeInstanceOf(Date);
        });
    });

    describe("sendDigestEmail", () => {
        it("enqueues and delivers digest email", async () => {
            const service = makeService();
            const id = await service.sendDigestEmail(recipient, digestPayload);

            expect(mocks.sendMail).toHaveBeenCalledOnce();
            expect(service.getDeliveryStatus(id)?.status).toBe("sent");
        });

        it("digest subject contains periodLabel", async () => {
            const service = makeService();
            await service.sendDigestEmail(recipient, digestPayload);

            const callArgs = mocks.sendMail.mock.calls[0][0];
            expect(callArgs.subject).toContain("Daily");
        });
    });

    describe("retry on failure", () => {
        it("succeeds after two failures on third attempt", async () => {
            const service = makeService();
            mocks.sendMail
                .mockRejectedValueOnce(new Error("SMTP timeout"))
                .mockRejectedValueOnce(new Error("SMTP timeout"))
                .mockResolvedValue({ messageId: "msg-ok" });

            const id = await service.sendAlertEmail(recipient, alertPayload);

            expect(service.getDeliveryStatus(id)?.status).toBe("sent");
            expect(mocks.sendMail).toHaveBeenCalledTimes(3);
        });

        it("marks as failed after maxAttempts exhausted", async () => {
            const service = makeService();
            mocks.sendMail.mockRejectedValue(new Error("SMTP unavailable"));

            const id = await service.sendAlertEmail(recipient, alertPayload);

            expect(service.getDeliveryStatus(id)?.status).toBe("failed");
            expect(mocks.sendMail).toHaveBeenCalledTimes(3);
        });

        it("records lastError on failure", async () => {
            const service = makeService();
            mocks.sendMail.mockRejectedValue(new Error("connection refused"));

            const id = await service.sendAlertEmail(recipient, alertPayload);
            const status = service.getDeliveryStatus(id);

            expect(status?.lastError).toBeTruthy();
            expect(typeof status?.lastError).toBe("string");
        });
    });

    describe("unsubscribed skip", () => {
        it("skips delivery for unsubscribed email", async () => {
            const service = makeService();
            service.unsubscribe(recipient.email);

            const id = await service.sendAlertEmail(recipient, alertPayload);

            expect(service.getDeliveryStatus(id)?.status).toBe("unsubscribed");
            expect(mocks.sendMail).not.toHaveBeenCalled();
        });

        it("isUnsubscribed returns true after unsubscribe", () => {
            const service = makeService();
            service.unsubscribe("test@example.com");

            expect(service.isUnsubscribed("test@example.com")).toBe(true);
        });
    });

    describe("bounced skip", () => {
        it("skips delivery for bounced email", async () => {
            const service = makeService();
            service.markBounced(recipient.email);

            const id = await service.sendAlertEmail(recipient, alertPayload);

            expect(service.getDeliveryStatus(id)?.status).toBe("bounced");
            expect(mocks.sendMail).not.toHaveBeenCalled();
        });

        it("isBounced returns true after markBounced", () => {
            const service = makeService();
            service.markBounced("bounce@example.com");

            expect(service.isBounced("bounce@example.com")).toBe(true);
        });
    });

    describe("getStats", () => {
        it("counts sent correctly", async () => {
            const service = makeService();
            await service.sendAlertEmail(recipient, alertPayload);
            await service.sendAlertEmail({ email: "bob@example.com" }, alertPayload);

            expect(service.getStats().sent).toBe(2);
        });

        it("counts failed correctly", async () => {
            const service = makeService();
            mocks.sendMail.mockRejectedValue(new Error("fail"));

            await service.sendAlertEmail(recipient, alertPayload);

            expect(service.getStats().failed).toBe(1);
        });

        it("counts unsubscribed correctly", async () => {
            const service = makeService();
            service.unsubscribe(recipient.email);
            await service.sendAlertEmail(recipient, alertPayload);

            expect(service.getStats().unsubscribed).toBe(1);
        });
    });

    describe("verifyProviderConnection", () => {
        it("returns true when SMTP verify succeeds", async () => {
            const service = makeService();
            mocks.verify.mockResolvedValue(true);

            const result = await service.verifyProviderConnection();

            expect(result).toBe(true);
        });

        it("returns false when SMTP verify throws", async () => {
            const service = makeService();
            mocks.verify.mockRejectedValue(new Error("auth failed"));

            const result = await service.verifyProviderConnection();

            expect(result).toBe(false);
        });

        it("returns false when no transporter is configured", async () => {
            const service = makeService();
            vi.spyOn(service as any, "getTransporter").mockReturnValue(null);

            const result = await service.verifyProviderConnection();

            expect(result).toBe(false);
        });
    });
});

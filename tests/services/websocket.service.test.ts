import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebsocketService } from "../../src/services/websocket.js";

function createSocket() {
  return {
    send: vi.fn(),
    on: vi.fn(),
  };
}

describe("WebsocketService", () => {
  let service: WebsocketService;

  beforeEach(() => {
    service = WebsocketService.getInstance();
    const anyService = service as any;
    anyService.clients = new Map();
    anyService.topicSubscribers = new Map();
    anyService.history = new Map();
    anyService.sequenceCounter = 0;
    anyService.replayMetrics = {
      totalExpired: 0,
      replayRequests: 0,
      replayMessagesDelivered: 0,
    };
    anyService.queue = [];
  });

  it("should register a client and deliver a subscribed price update", () => {
    const socket = createSocket();
    const clientId = service.addClient(socket);

    service.subscribe(clientId, "prices", { symbol: "USDC" });
    service.publish("price_update", "prices:USDC", { symbol: "USDC", price: 1.0 }, { priority: "high" });

    expect(socket.send).toHaveBeenCalled();
    const payloads = socket.send.mock.calls.map((call) => JSON.parse(call[0] as string));
    const batchPayload = payloads.find((payload) => payload.type === "batch");

    expect(batchPayload).toBeDefined();
    expect(batchPayload.messages).toHaveLength(1);
    expect(batchPayload.messages[0].type).toBe("price_update");
    expect(batchPayload.messages[0].topic).toBe("prices:USDC");
    expect(batchPayload.messages[0].sequence).toBe(1);
  });

  it("should replay messages by topic and sequence", () => {
    service.publish("price_update", "prices:USDC", { symbol: "USDC", price: 1.0 });
    service.publish("price_update", "prices:EURC", { symbol: "EURC", price: 1.1 });
    service.publish("transaction_update", "bridge.main", { event: "created" });

    const replay = service.getReplayMessages(["prices"], { sinceSequence: 1, limit: 5 });

    expect(replay).toHaveLength(1);
    expect(replay[0].topic).toBe("prices:EURC");
    expect(replay[0].sequence).toBe(2);
  });

  it("should expire old replay messages and expose replay metrics", () => {
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(1_000);
    service.publish(
      "price_update",
      "prices:USDC",
      { symbol: "USDC", price: 1.0 },
      { timestamp: new Date(1_000).toISOString() },
    );

    nowSpy.mockReturnValue(1_000 + 5 * 60 * 1000 + 10);
    const replay = service.getReplayMessages(["prices:USDC"], { limit: 5 });
    const metrics = service.getReplayMetrics();

    expect(replay).toHaveLength(0);
    expect(metrics.totalExpired).toBeGreaterThanOrEqual(1);
    expect(metrics.replayRequests).toBeGreaterThanOrEqual(1);

    nowSpy.mockRestore();
  });
});

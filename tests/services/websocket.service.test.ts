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
  });
});

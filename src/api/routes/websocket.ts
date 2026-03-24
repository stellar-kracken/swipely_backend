import type { FastifyInstance } from "fastify";

// WS /api/v1/ws - WebSocket for real-time updates

export async function websocketRoutes(server: FastifyInstance) {
  server.get("/", { websocket: true }, (socket, _request) => {
    server.log.info("WebSocket client connected");

    socket.on("message", (message: Buffer) => {
      const data = message.toString();
      server.log.debug(`WebSocket message received: ${data}`);

      try {
        const parsed = JSON.parse(data);

        // Handle subscription requests
        if (parsed.type === "subscribe") {
          // TODO: Add client to subscription channel (e.g., asset price updates)
          socket.send(
            JSON.stringify({
              type: "subscribed",
              channel: parsed.channel,
            })
          );
        }

        if (parsed.type === "unsubscribe") {
          // TODO: Remove client from subscription channel
          socket.send(
            JSON.stringify({
              type: "unsubscribed",
              channel: parsed.channel,
            })
          );
        }
      } catch {
        socket.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
      }
    });

    socket.on("close", () => {
      server.log.info("WebSocket client disconnected");
    });
  });
}

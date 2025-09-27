import { SimpleDurableObjectQueue } from "SimpleDurableObjectQueue";
import { Environment } from "entities/domain/queue";
import { Context, Hono } from "hono";
import { QueueAuthMiddleware } from "middleware/QueueAuthMiddleware";
import { ValidatePayloadSizeMiddleware } from "middleware/ValidatePayloadSizeMiddleware";

const app = new Hono<Environment>();

// Helper to get Durable Object instance
async function getQueue(env: any): Promise<DurableObjectStub> {
  const id = env.SIMPLE_QUEUE.idFromName("default-queue");
  const stub = env.SIMPLE_QUEUE.get(id);
  return stub;
}

// Apply authentication middleware to all routes except health
app.use("*", QueueAuthMiddleware);

// Apply payload validation to POST routes
app.use("/publish", ValidatePayloadSizeMiddleware);
app.use("/complete", ValidatePayloadSizeMiddleware);
app.use("/fail", ValidatePayloadSizeMiddleware);

// Define routes - using Hono for HTTP handling, DO for state
app.post("/publish", async (c: Context) => {
  const queueDO = await getQueue(c.env);
  const body = await c.req.json();

  const result = await (queueDO as any).publish(body);
  return c.json(result);
});

app.get("/poll", async (c: Context) => {
  const queueDO = await getQueue(c.env);
  const url = new URL(c.req.url);
  const limit = parseInt(url.searchParams.get("limit") || "1");
  const timeout = parseInt(url.searchParams.get("timeout") || "30000");

  const result = await (queueDO as any).poll({ limit, timeout });
  return c.json(result);
});

app.post("/complete", async (c: Context) => {
  const queueDO = await getQueue(c.env);
  const { messageId } = await c.req.json();

  const result = await (queueDO as any).complete({ messageId });
  return c.json(result);
});

app.post("/fail", async (c: Context) => {
  const queueDO = await getQueue(c.env);
  const { messageId, error } = await c.req.json();

  const result = await (queueDO as any).fail({ messageId, error });
  return c.json(result);
});

app.get("/stats", async (c: Context) => {
  const queueDO = await getQueue(c.env);
  const result = await (queueDO as any).getStats();
  return c.json(result);
});

app.delete("/clear", async (c: Context) => {
  const queueDO = await getQueue(c.env);
  const result = await (queueDO as any).clear();
  return c.json(result);
});

app.get("/health", async (c: Context) => {
  const queueDO = await getQueue(c.env);
  const result = await (queueDO as any).getHealth();
  return c.json(result, result.status === "healthy" ? 200 : 503);
});

// Global error handler
app.onError((err, c) => {
  console.error("Queue worker error:", err);
  return c.json(
    {
      error: "Internal error",
      message: err instanceof Error ? err.message : "Unknown error",
    },
    500
  );
});

// 404 handler
app.notFound((c) => {
  return c.text("Not Found", 404);
});

app.get("/", (c) => {
  return c.text("Queue Worker with Durable Objects");
});

export default {
  fetch: app.fetch,

  // Scheduled handler - calls DO method directly
  scheduled: async (
    event: ScheduledEvent,
    env: Environment,
    ctx: ExecutionContext
  ) => {
    const queueDO = await getQueue(env);
    console.log("scheduler run");
    ctx.waitUntil((queueDO as any).runScheduledProcessing());
  },
};

// Export the Durable Object class
export { SimpleDurableObjectQueue };

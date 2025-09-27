import { Context } from "hono";

export const ValidatePayloadSizeMiddleware = async (c: Context, next: any) => {
  const contentLength = parseInt(c.req.header("content-length") || "0");
  if (contentLength > c.env.MAX_PAYLOAD_SIZE) {
    return c.json(
      {
        error: "Payload too large",
        maxSize: c.env.MAX_PAYLOAD_SIZE,
        receivedSize: contentLength,
      },
      413
    );
  }
  await next();
};

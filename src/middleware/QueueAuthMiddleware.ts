import { Context } from "hono";

export const QueueAuthMiddleware = async (c: Context, next: any) => {
  const auth = c.req.header("Authorization");
  if (auth !== `Bearer ${c.env.API_KEY}`) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
};

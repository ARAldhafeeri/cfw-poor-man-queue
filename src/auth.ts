import { Environment } from "./types";

function authenticate(request: Request, env: Environment): boolean {
  const auth = request.headers.get("Authorization");
  return auth === `Bearer ${env.API_KEY}`;
}

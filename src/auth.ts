function authenticate(request: Request, env: any): boolean {
  const auth = request.headers.get("Authorization");
  return auth === `Bearer ${env.API_KEY}`;
}

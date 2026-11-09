// Cloudflare Pages Function: proxies /api/* to the Fly API, forwarding all headers
// (notably Cf-Access-Jwt-Assertion). The API validates the JWT itself.
interface Env {
  FLY_API_ORIGIN: string;
  BASE_PROXY_SECRET?: string;
}

export const onRequest = async ({ request, env }: { request: Request; env: Env }) => {
  const url = new URL(request.url);
  const target = new URL(url.pathname + url.search, env.FLY_API_ORIGIN);
  const headers = new Headers(request.headers);
  if (env.BASE_PROXY_SECRET) headers.set("X-Base-Proxy-Secret", env.BASE_PROXY_SECRET);
  return fetch(new Request(target, { method: request.method, headers, body: request.body, redirect: "manual" }));
};

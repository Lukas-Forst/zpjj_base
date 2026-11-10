import { OpenAPIHono } from "@hono/zod-openapi";
import { HttpError } from "./errors";
import type { AppEnv } from "./types";

export function createApp(): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json({ detail: result.error.issues[0]?.message ?? "Ungültige Eingabe." }, 422);
      }
    },
  });

  app.use("*", async (c, next) => {
    await next();
    c.res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    c.res.headers.set("X-Content-Type-Options", "nosniff");
    c.res.headers.set("Referrer-Policy", "same-origin");
  });

  app.get("/healthz", (c) => c.json({ ok: true }));

  app.notFound((c) => c.json({ detail: "Nicht gefunden." }, 404));
  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ detail: err.detail }, err.status as 400);
    console.error(err);
    return c.json({ detail: "Interner Fehler." }, 500);
  });

  return app;
}

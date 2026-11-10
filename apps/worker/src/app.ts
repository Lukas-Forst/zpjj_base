import { OpenAPIHono } from "@hono/zod-openapi";
import { auth } from "./auth";
import { onVacationChange } from "./calsync";
import { HttpError } from "./errors";
import { hooks } from "./hooks";
import { attendance } from "./routers/attendance";
import { coverage } from "./routers/coverage";
import { me } from "./routers/me";
import { presets } from "./routers/presets";
import { slots } from "./routers/slots";
import { syncStatus } from "./routers/syncStatus";
import { today } from "./routers/today";
import { trials } from "./routers/trials";
import { users } from "./routers/users";
import { vacations } from "./routers/vacations";
import type { AppEnv } from "./types";

hooks.onVacationChange = onVacationChange;

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

  app.use("/api/*", auth);
  app.route("/api", me);
  app.route("/api", users);
  app.route("/api", slots);
  app.route("/api", presets);
  app.route("/api", vacations);
  app.route("/api", coverage);
  app.route("/api", attendance);
  app.route("/api", trials);
  app.route("/api", today);
  app.route("/api", syncStatus);

  app.notFound((c) => c.json({ detail: "Nicht gefunden." }, 404));
  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ detail: err.detail }, err.status as 400);
    console.error(err);
    return c.json({ detail: "Interner Fehler." }, 500);
  });

  return app;
}

export function buildOpenApi() {
  return createApp().getOpenAPI31Document({ openapi: "3.1.0", info: { title: "ZPJJ Base API", version: "0.1.0" } });
}

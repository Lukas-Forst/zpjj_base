import { createApp } from "./app";
import type { Bindings } from "./types";

const app = createApp();

export default {
  fetch(req: Request, env: Bindings, ctx: ExecutionContext): Response | Promise<Response> {
    const { pathname } = new URL(req.url);
    if (pathname === "/healthz" || pathname === "/api" || pathname.startsWith("/api/")) {
      return app.fetch(req, env, ctx);
    }
    return env.ASSETS.fetch(req);
  },
  async scheduled(_event: ScheduledController, _env: Bindings, _ctx: ExecutionContext): Promise<void> {
    // filled by the calendar sync task
  },
};

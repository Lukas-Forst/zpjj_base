import type { Context } from "hono";
import type { AppEnv } from "./types";

/** Slots filled by later tasks (calendar sync). Default: none. */
export const hooks: { onVacationChange?: (c: Context<AppEnv>) => Promise<void> } = {};

/** Fire-and-forget after a saved vacation change; a failing hook never fails the request. */
export function vacationChanged(c: Context<AppEnv>): void {
  c.executionCtx.waitUntil(
    Promise.resolve()
      .then(() => hooks.onVacationChange?.(c))
      .catch((e) => console.error("calendar sync trigger failed", e)),
  );
}

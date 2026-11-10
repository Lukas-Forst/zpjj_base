import type { Bindings } from "./types";

export type Settings = {
  env: string;
  cfAccessTeamDomain: string;
  cfAccessAud: string;
  bootstrapAdminEmails: string[];
  authDevEmail: string;
  gcalServiceAccountJson: string;
};

export function loadSettings(e: Bindings): Settings {
  return {
    env: e.ENV ?? "prod",
    cfAccessTeamDomain: e.CF_ACCESS_TEAM_DOMAIN ?? "",
    cfAccessAud: e.CF_ACCESS_AUD ?? "",
    bootstrapAdminEmails: (e.BOOTSTRAP_ADMIN_EMAILS ?? "")
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean),
    authDevEmail: (e.AUTH_DEV_EMAIL ?? "").trim().toLowerCase(),
    gcalServiceAccountJson: e.GCAL_SERVICE_ACCOUNT_JSON ?? "",
  };
}

/** Fail closed: same checks and messages as Python Settings.validate. */
export function validateSettings(s: Settings): void {
  if (s.gcalServiceAccountJson) {
    try {
      JSON.parse(s.gcalServiceAccountJson);
    } catch {
      throw new Error("GCAL_SERVICE_ACCOUNT_JSON is not valid JSON");
    }
  }
  if (s.authDevEmail && s.env !== "dev") {
    throw new Error("AUTH_DEV_EMAIL is set but ENV is not 'dev': refusing to start");
  }
  if (s.env !== "dev" && !(s.cfAccessTeamDomain && s.cfAccessAud)) {
    throw new Error("CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD are required outside dev");
  }
}

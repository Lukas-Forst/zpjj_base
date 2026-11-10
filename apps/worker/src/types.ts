export type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  ENV?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  BOOTSTRAP_ADMIN_EMAILS?: string;
  AUTH_DEV_EMAIL?: string;
  TRELLO_KEY?: string;
  TRELLO_TOKEN?: string;
  TRELLO_BOARD?: string;
  GCAL_CALENDAR_ID?: string;
  GCAL_SERVICE_ACCOUNT_JSON?: string;
};

export type User = {
  id: number;
  email: string;
  display_name: string;
  role: "gesellschafter" | "trainer";
  is_trainer: boolean;
  active: boolean;
};

export type AppEnv = { Bindings: Bindings; Variables: { user: User } };

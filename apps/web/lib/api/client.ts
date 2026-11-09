import createClient from "openapi-fetch";
import type { paths } from "./schema";

// Same origin: the Pages Function proxies /api/* to the Fly API.
export const api = createClient<paths>({ baseUrl: "" });

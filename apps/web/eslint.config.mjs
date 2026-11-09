import next from "eslint-config-next";

export default [
  ...next,
  // fetch-on-mount in effects is the data loading pattern of this static-export app
  { rules: { "react-hooks/set-state-in-effect": "off", "import/no-anonymous-default-export": "off" } },
  { ignores: [".next/", "out/", "lib/api/schema.d.ts", "public/sw.js", "functions/"] },
];

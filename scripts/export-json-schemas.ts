import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EXTRACTION_JSON_SCHEMA } from "../src/contracts/extraction.js";
import { VALIDATION_RESULT_JSON_SCHEMA } from "../src/contracts/validation.js";
import { ROUTER_DECISION_JSON_SCHEMA } from "../src/contracts/router.js";
import { PERSISTED_RUN_JSON_SCHEMA } from "../src/contracts/run-state.js";
import { CUSTOMER_RULE_SET_JSON_SCHEMA } from "../src/contracts/customer-rules.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "schemas");
mkdirSync(outDir, { recursive: true });

const files: [string, Record<string, unknown>][] = [
  ["extraction.schema.json", EXTRACTION_JSON_SCHEMA as Record<string, unknown>],
  ["validation-result.schema.json", VALIDATION_RESULT_JSON_SCHEMA],
  ["router-decision.schema.json", ROUTER_DECISION_JSON_SCHEMA],
  ["persisted-run.schema.json", PERSISTED_RUN_JSON_SCHEMA],
  ["customer-rule-set.schema.json", CUSTOMER_RULE_SET_JSON_SCHEMA],
];

for (const [name, schema] of files) {
  writeFileSync(join(outDir, name), JSON.stringify(schema, null, 2), "utf8");
}
console.log("Wrote JSON schemas to", outDir);

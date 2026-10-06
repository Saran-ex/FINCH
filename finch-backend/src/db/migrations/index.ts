import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface Migration {
  name: string;
  sql: string;
}

function readSql(filename: string): string {
  const filePath = path.join(__dirname, filename);
  return fs.readFileSync(filePath, "utf-8");
}

export const migrations: Migration[] = [
  { name: "001_initial", sql: readSql("001_initial.sql") },
  { name: "002_seed", sql: readSql("002_seed.sql") },
  { name: "003_update_plan_prompt", sql: readSql("003_update_plan_prompt.sql") },
  { name: "004_fix_plan_prompt", sql: readSql("004_fix_plan_prompt.sql") },
  { name: "005_update_research_prompt", sql: readSql("005_update_research_prompt.sql") },
  { name: "007_memory_box", sql: readSql("007_memory_box.sql") },
  { name: "008_seed_additional_aliases", sql: readSql("008_seed_additional_aliases.sql") },
  { name: "009_mode_allowed_models", sql: readSql("009_mode_allowed_models.sql") },
  { name: "010_search_web_prompt", sql: readSql("010_search_web_prompt.sql") },
  { name: "011_search_prompt_simple", sql: readSql("011_search_prompt_simple.sql") },
  { name: "012_research_web_prompt", sql: readSql("012_research_web_prompt.sql") },
  { name: "013_card_prompts", sql: readSql("013_card_prompts.sql") },
  { name: "014_research_resources", sql: readSql("014_research_resources.sql") },
  { name: "015_trust_entries", sql: readSql("015_trust_entries.sql") },
  { name: "016_turn_results", sql: readSql("016_turn_results.sql") },
  { name: "017_dynamic_model_library", sql: readSql("017_dynamic_model_library.sql") },
];
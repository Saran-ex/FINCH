import { db } from "../db/client.js";
import { logger } from "./logger.js";

export function listResearchResourceCategoryNames(): string[] {
  try {
    const rows = db
      .prepare("SELECT name FROM research_resource_categories ORDER BY name ASC")
      .all() as Array<{ name: string }>;
    return rows.map((row) => row.name);
  } catch (err) {
    logger.warn("research resources: failed to load category names", {
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

export function listResearchResourceSitesForCategory(categoryName: string): string[] {
  try {
    const rows = db
      .prepare(
        `SELECT url FROM research_resource_sites s
           JOIN research_resource_categories c ON c.id = s.category_id
          WHERE c.name = ?
          ORDER BY s.url ASC`
      )
      .all(categoryName) as Array<{ url: string }>;
    return rows.map((row) => row.url);
  } catch (err) {
    logger.warn("research resources: failed to load sites for category", {
      categoryName,
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

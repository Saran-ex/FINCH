import { Router } from "express";
import { db } from "../../../db/client.js";
import { validateCategoryBody, validateSiteBody } from "../../schemas/controlSchema.js";
import { NotFoundError, ValidationError } from "../../../services/errors.js";
import { logger } from "../../../services/logger.js";

const router = Router();

const MAX_CATEGORIES = 10;
const MAX_SITES_PER_CATEGORY = 10;

type CategoryRow = {
  id: number;
  name: string;
};

type SiteRow = {
  id: number;
  category_id: number;
  url: string;
};

function readId(raw: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new ValidationError("id must be a positive integer");
  }
  const id = parseInt(raw, 10);
  if (id <= 0) {
    throw new ValidationError("id must be a positive integer");
  }
  return id;
}

function categoryExists(name: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM research_resource_categories WHERE name = ?")
    .get(name);
  return row !== undefined;
}

function categoryCount(): number {
  const row = db
    .prepare("SELECT COUNT(*) AS count FROM research_resource_categories")
    .get() as { count: number };
  return row.count;
}

function siteCount(categoryId: number): number {
  const row = db
    .prepare("SELECT COUNT(*) AS count FROM research_resource_sites WHERE category_id = ?")
    .get(categoryId) as { count: number };
  return row.count;
}

router.get("/", (_req, res, next) => {
  try {
    const categories = db
      .prepare("SELECT id, name FROM research_resource_categories ORDER BY name ASC")
      .all() as CategoryRow[];

    const sitesByCategory = new Map<number, Array<{ id: number; url: string }>>();
    const sites = db
      .prepare(
        "SELECT id, category_id, url FROM research_resource_sites ORDER BY url ASC"
      )
      .all() as SiteRow[];
    for (const site of sites) {
      const list = sitesByCategory.get(site.category_id) ?? [];
      list.push({ id: site.id, url: site.url });
      sitesByCategory.set(site.category_id, list);
    }

    res.json({
      categories: categories.map((category) => ({
        id: category.id,
        name: category.name,
        sites: sitesByCategory.get(category.id) ?? [],
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/categories", (req, res, next) => {
  try {
    const { name } = validateCategoryBody(req.body);

    if (categoryExists(name)) {
      throw new ValidationError("Category already exists");
    }
    if (categoryCount() >= MAX_CATEGORIES) {
      throw new ValidationError("Maximum 10 categories allowed");
    }

    const result = db
      .prepare("INSERT INTO research_resource_categories (name) VALUES (?)")
      .run(name);

    logger.info("research resource category created", { name });
    res.status(201).json({ id: Number(result.lastInsertRowid), name, sites: [] });
  } catch (err) {
    next(err);
  }
});

router.delete("/categories/:id", (req, res, next) => {
  try {
    const id = readId(req.params.id);

    const existing = db
      .prepare("SELECT 1 FROM research_resource_categories WHERE id = ?")
      .get(id);
    if (!existing) {
      throw new NotFoundError("Category not found");
    }

    db.prepare("DELETE FROM research_resource_categories WHERE id = ?").run(id);

    logger.info("research resource category deleted", { id });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post("/categories/:id/sites", (req, res, next) => {
  try {
    const categoryId = readId(req.params.id);
    const { url } = validateSiteBody(req.body);

    const existing = db
      .prepare("SELECT 1 FROM research_resource_categories WHERE id = ?")
      .get(categoryId);
    if (!existing) {
      throw new NotFoundError("Category not found");
    }

    if (siteCount(categoryId) >= MAX_SITES_PER_CATEGORY) {
      throw new ValidationError("Maximum 10 sites per category");
    }

    const duplicate = db
      .prepare(
        "SELECT 1 FROM research_resource_sites WHERE category_id = ? AND url = ?"
      )
      .get(categoryId, url);
    if (duplicate) {
      throw new ValidationError("This site is already in this category");
    }

    const result = db
      .prepare(
        "INSERT INTO research_resource_sites (category_id, url) VALUES (?, ?)"
      )
      .run(categoryId, url);

    logger.info("research resource site added", { categoryId, url });
    res.status(201).json({ id: Number(result.lastInsertRowid), url });
  } catch (err) {
    next(err);
  }
});

router.delete("/sites/:id", (req, res, next) => {
  try {
    const id = readId(req.params.id);

    const existing = db
      .prepare("SELECT 1 FROM research_resource_sites WHERE id = ?")
      .get(id);
    if (!existing) {
      throw new NotFoundError("Site not found");
    }

    db.prepare("DELETE FROM research_resource_sites WHERE id = ?").run(id);

    logger.info("research resource site deleted", { id });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;

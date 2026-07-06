import { Hono } from "hono";
import type { Env } from "../types";

export const runsRoute = new Hono<{ Bindings: Env }>();

runsRoute.get("/", async (c) => {
  const limit = Math.max(1, Number(c.req.query("limit")) || 50);
  const rows = await c.env.DB
    .prepare(`SELECT * FROM ingest_runs ORDER BY id DESC LIMIT ?`)
    .bind(limit)
    .all();
  return c.json(rows.results);
});

runsRoute.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const row = await c.env.DB.prepare(`SELECT * FROM ingest_runs WHERE id = ?`).bind(id).first();
  if (!row) return c.json({ detail: "Run not found" }, 404);
  return c.json(row);
});

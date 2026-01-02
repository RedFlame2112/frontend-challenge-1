import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { generateMrfFiles } from "./mrf/generator.js";
import { MrfStorage } from "./mrf/storage.js";
import type { ClaimInput } from "./mrf/types.js";

// Hono API for generating and serving MRF files.
const app = new Hono();
const storage = new MrfStorage();

app.use("/api/*", cors({ origin: "*", allowMethods: ["GET", "POST"] }));

app.get("/", (c) => c.text("MRF API is running."));

app.post("/api/mrf", async (c) => {
  try {
    const body = await c.req.json();
    const claims = Array.isArray(body?.claims) ? (body.claims as ClaimInput[]) : [];

    if (claims.length === 0) {
      return c.json({ error: "No claims provided." }, 400);
    }

    const generated = generateMrfFiles(claims);
    if (generated.length === 0) {
      return c.json({ error: "No valid claims to generate MRF files." }, 400);
    }
    const records = [];
    for (const file of generated) {
      records.push(await storage.save(file));
    }

    return c.json({ generated: records });
  } catch (error) {
    return c.json({ error: "Failed to generate MRF files." }, 500);
  }
});

app.get("/api/mrf", async (c) => {
  const customerId = c.req.query("customerId");
  const customers = await storage.list(customerId);
  return c.json({ customers });
});

app.get("/api/mrf/:customerId", async (c) => {
  const customerId = c.req.param("customerId");
  const customers = await storage.list(customerId);
  return c.json({ customers });
});

app.get("/api/mrf/:customerId/files/:fileName", async (c) => {
  const customerId = c.req.param("customerId");
  const fileName = c.req.param("fileName");
  const data = await storage.readFile(customerId, fileName);
  if (!data) {
    return c.json({ error: "File not found." }, 404);
  }

  return c.body(data, 200, { "Content-Type": "application/json" });
});

serve({ fetch: app.fetch, port: 8080 });
console.log("Server is running on http://localhost:8080");

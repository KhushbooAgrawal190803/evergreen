import express from "express";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { api } from "./api.js";
import { seedDemo } from "./seed.js";
import { ensureUsers, DEMO } from "./auth.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 5173);
const prod = process.env.NODE_ENV === "production";

if (DEMO && seedDemo()) console.log("Loaded demo data (first run).");
ensureUsers();

const app = express();
app.disable("x-powered-by");
if (prod) app.set("trust proxy", 1); // real client IP behind a reverse proxy, for sign-in lockout
app.use("/api", api);

if (prod) {
  app.use(express.static(join(root, "dist")));
  app.get("/{*path}", (_req, res) => res.sendFile(join(root, "dist", "index.html")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({ root, server: { middlewareMode: true }, appType: "spa" });
  app.use(vite.middlewares);
}

app.listen(PORT, () => console.log(`Evergreen running at http://localhost:${PORT}`));

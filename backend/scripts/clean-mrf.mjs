import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mrfDir = path.resolve(__dirname, "..", "data", "mrf");

// Clear generated MRF data between local runs.
await rm(mrfDir, { recursive: true, force: true });

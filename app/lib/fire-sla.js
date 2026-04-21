import { readFile } from "fs/promises";
import path from "path";

function getSlaDataPath() {
  return path.join(process.cwd(), "public", "data", "fire", "fire-sla-analysis.json");
}

export async function readFireSlaAnalysis() {
  const text = await readFile(getSlaDataPath(), "utf8");
  return JSON.parse(text);
}

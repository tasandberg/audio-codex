import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const [version, tagArg] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("Usage: node scripts/package.mjs <version> [tag]");
  process.exit(1);
}
const tag = tagArg || version;

const manifest = JSON.parse(readFileSync("./module.json", "utf8"));
manifest.version = version;
manifest.manifest = `${manifest.url}/releases/latest/download/module.json`;
manifest.download = `${manifest.url}/releases/download/${tag}/module.zip`;
writeFileSync("./module.json", `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Stamped module.json ${version} (download → ${manifest.download})`);

mkdirSync("build", { recursive: true });
rmSync("build/module.zip", { force: true });
execSync('zip -rq build/module.zip module.json LICENSE README.md dist/ lang/ templates/ -x "*.map"', { stdio: "inherit" });
console.log("Wrote build/module.zip");

// Builds the TV app into build/app and packages build/MusicAssistantTV.wgt (unsigned; the
// installer signs it for the TV).
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const version = process.env.VERSION ? process.env.VERSION.replace(/^v/, "") : pkg.version;
const out = "build/app";
rmSync("build", { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: ["src/app.ts"],
  bundle: true,
  minify: true,
  format: "iife",
  // Tizen 5.5 (2020 TVs) runs Chromium 69; newer TVs run newer engines.
  target: ["chrome69"],
  define: { APP_VERSION: JSON.stringify(version) },
  outfile: `${out}/app.js`,
  legalComments: "none",
  logLevel: "warning",
});

copyFileSync("static/index.html", `${out}/index.html`);
copyFileSync("static/style.css", `${out}/style.css`);
copyFileSync("static/icon.png", `${out}/icon.png`);
writeFileSync(`${out}/config.xml`, readFileSync("static/config.xml", "utf8").replace("@VERSION@", version));

// A .wgt is a zip of the app folder.
const wgt = "build/MusicAssistantTV.wgt";
execFileSync("python3", ["-c", `
import os, zipfile, sys
src, dst = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as z:
    for root, _, files in os.walk(src):
        for f in sorted(files):
            p = os.path.join(root, f)
            z.write(p, os.path.relpath(p, src))
`, out, wgt]);
console.log(`built ${wgt} (version ${version})`);
if (!existsSync(wgt)) process.exit(1);

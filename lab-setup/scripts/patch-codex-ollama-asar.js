#!/usr/bin/env node

const cp = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const appAsar = process.argv[2];

const fastModel = "qwen36-35b-fast:latest";
const thinkModel = "qwen36-35b-think:latest";
const fastName = "Qwen3.6 Uncensored Aggressive - Fast";
const thinkName = "Qwen3.6 Uncensored Aggressive - Think";

function fail(message) {
  console.error(`[codex-ollama-asar] ${message}`);
  process.exit(1);
}

function findAsarCli() {
  const explicit = process.env.ASAR_CLI;
  if (explicit && fs.existsSync(explicit)) return explicit;

  const localAppData = process.env.LOCALAPPDATA;
  const candidates = [];
  if (localAppData) {
    const npxRoot = path.join(localAppData, "npm-cache", "_npx");
    if (fs.existsSync(npxRoot)) {
      for (const child of fs.readdirSync(npxRoot, { withFileTypes: true })) {
        if (!child.isDirectory()) continue;
        candidates.push(
          path.join(npxRoot, child.name, "node_modules", ".bin", process.platform === "win32" ? "asar.cmd" : "asar"),
        );
      }
    }
  }

  candidates.sort((a, b) => {
    const aTime = fs.existsSync(a) ? fs.statSync(a).mtimeMs : 0;
    const bTime = fs.existsSync(b) ? fs.statSync(b).mtimeMs : 0;
    return bTime - aTime;
  });

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  fail("No encontre @electron/asar en cache de npx. Ejecuta una vez: npx --yes @electron/asar --version");
}

function run(file, args) {
  const result = cp.spawnSync(file, args, {
    shell: process.platform === "win32" && file.toLowerCase().endsWith(".cmd"),
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.status !== 0) {
    fail(`Fallo comando: ${file} ${args.join(" ")}`);
  }
}

function findComposerFile(extractDir) {
  const assetsDir = path.join(extractDir, "webview", "assets");
  const files = fs
    .readdirSync(assetsDir)
    .filter((name) => /^composer-.*\.js$/.test(name) && !/^composer-atoms-/.test(name));
  if (files.length !== 1) {
    fail(`Esperaba 1 composer bundle y encontre ${files.length}.`);
  }
  return path.join(assetsDir, files[0]);
}

function patchFeaturedModels(source) {
  if (source.includes(`var mT=[\`${fastModel}\``) || source.includes(`[\`${fastModel}\`,\`${thinkModel}\`,`)) {
    return { source, changed: false };
  }

  const pattern =
    /var ([A-Za-z_$][\w$]*)=\[`gpt-5\.5`,`gpt-5\.4`\];function ([A-Za-z_$][\w$]*)\(e,t\)\{let n=new Map\(e\.map\(e=>\[e\.model,e\]\)\),r=new Set\(t\);return\{featuredModels:t\.flatMap\(e=>\{let t=n\.get\(e\);return t==null\?\[\]:\[t\]\}\),otherModels:e\.filter\(e=>!r\.has\(e\.model\)\)\}\}/;

  const replacement =
    "var $1=[`" +
    fastModel +
    "`,`" +
    thinkModel +
    "`,`gpt-5.5`,`gpt-5.4`];function $2(e,t){let n=new Map(e.map(e=>[e.model,e])),r=new Set(t),i=n.get(`" +
    fastModel +
    "`)??n.get(`qwen36-35b-fast`),a=n.get(`" +
    thinkModel +
    "`)??n.get(`qwen36-35b-think`),o=[{reasoningEffort:`low`,description:``},{reasoningEffort:`medium`,description:``},{reasoningEffort:`high`,description:``},{reasoningEffort:`xhigh`,description:``}],s=e[0]??{description:``,supportedReasoningEfforts:o,defaultReasoningEffort:`low`};i==null&&(i={...s,model:`" +
    fastModel +
    "`,displayName:`" +
    fastName +
    "`,description:`Local Ollama model with think:false`,supportedReasoningEfforts:s.supportedReasoningEfforts??o,defaultReasoningEffort:`low`},n.set(i.model,i),e=[i,...e]);a==null&&(a={...i,model:`" +
    thinkModel +
    "`,displayName:`" +
    thinkName +
    "`,description:`Local Ollama model with think:true`,supportedReasoningEfforts:i.supportedReasoningEfforts??o,defaultReasoningEffort:`xhigh`},n.set(a.model,a),e=[...e,a]);return{featuredModels:t.flatMap(e=>{let t=n.get(e);return t==null?[]:[t]}),otherModels:e.filter(e=>!r.has(e.model))}}";

  const next = source.replace(pattern, replacement);
  if (next === source) {
    fail("No pude encontrar la funcion de modelos destacados para parchear.");
  }
  return { source: next, changed: true };
}

function patchDisplayNames(source) {
  if (source.includes(`n===\`${fastModel}\`||n===\`qwen36-35b-fast\``)) {
    return { source, changed: false };
  }

  const marker = "}else if(n){let e;t[3]===Symbol.for(`react.memo_cache_sentinel`)?(e=";
  const insert =
    "}else if(n===`" +
    fastModel +
    "`||n===`qwen36-35b-fast`){l=`" +
    fastName +
    "`}else if(n===`" +
    thinkModel +
    "`||n===`qwen36-35b-think`){l=`" +
    thinkName +
    "`}else if(n===`fredrezones55/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive:latest`||n===`fredrezones55/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive`){l=`Qwen3.6-35B-Uncensored-Aggressive`}else if(n){let e;t[3]===Symbol.for(`react.memo_cache_sentinel`)?(e=";

  const index = source.indexOf(marker);
  if (index === -1) {
    fail("No pude encontrar la funcion de nombre visible del modelo para parchear.");
  }

  return {
    source: source.slice(0, index) + insert + source.slice(index + marker.length),
    changed: true,
  };
}

function main() {
  if (!appAsar) fail("Uso: node patch-codex-ollama-asar.js <app.asar>");
  if (!fs.existsSync(appAsar)) fail(`No existe ${appAsar}`);

  const asarCli = findAsarCli();
  const tempDir = path.join(os.tmpdir(), `codex-ollama-asar-${Date.now()}`);
  const nextAsar = `${appAsar}.patched-${Date.now()}`;
  fs.rmSync(tempDir, { recursive: true, force: true });
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    run(asarCli, ["extract", appAsar, tempDir]);
    const composerFile = findComposerFile(tempDir);
    let source = fs.readFileSync(composerFile, "utf8");

    const featured = patchFeaturedModels(source);
    source = featured.source;
    const names = patchDisplayNames(source);
    source = names.source;

    if (!featured.changed && !names.changed) {
      console.log("[codex-ollama-asar] El parche ya estaba aplicado.");
      return;
    }

    fs.writeFileSync(composerFile, source, "utf8");
    const backup = `${appAsar}.bak-auto-${new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14)}`;
    fs.copyFileSync(appAsar, backup);
    run(asarCli, ["pack", tempDir, nextAsar, "--unpack-dir", "node_modules"]);
    const nextUnpacked = `${nextAsar}.unpacked`;
    const finalUnpacked = `${appAsar}.unpacked`;
    if (fs.existsSync(nextUnpacked)) {
      fs.rmSync(finalUnpacked, { recursive: true, force: true });
      fs.renameSync(nextUnpacked, finalUnpacked);
    }
    fs.copyFileSync(nextAsar, appAsar);
    fs.rmSync(nextAsar, { force: true });
    console.log("[codex-ollama-asar] Parche aplicado.");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main();

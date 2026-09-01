/* Släpper en ny version av Mdash.
 *
 *   npm run release                  -- höjer sista siffran (0.1.0 -> 0.1.1)
 *   npm run release -- 0.2.0         -- sätter en bestämd version
 *   npm run release -- 0.2.0 "Text"  -- med släppanteckning som syns i appen
 *
 * Skriptet gör allt i ordning: höjer versionsnumret på de tre ställen det står,
 * bygger och signerar installeraren, skriver latest.json som appen frågar efter,
 * och laddar upp alltihop till GitHub. Efter det ser installerade appar
 * uppdateringen nästa gång de startar.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const KEY_PATH = path.join(process.env.USERPROFILE ?? "", ".tauri", "mdash.key");
const REPO = "HStenzelius/Mdash";

const say = (message) => console.log(message);
const die = (message) => {
  console.error(`\n  ✗ ${message}\n`);
  process.exit(1);
};

/** gh ligger inte alltid i PATH i den här processen. */
function findGh() {
  const fallback = "C:\\Program Files\\GitHub CLI\\gh.exe";
  const probe = spawnSync("gh", ["--version"], { shell: true });
  if (probe.status === 0) return "gh";
  if (fs.existsSync(fallback)) return fallback;
  die("GitHub CLI (gh) hittades inte. Installera med: winget install GitHub.cli");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: true,
    ...options,
  });
  if (result.status !== 0) die(`Kommandot misslyckades: ${command} ${args.join(" ")}`);
}

function capture(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", shell: true });
  return result.status === 0 ? result.stdout.trim() : "";
}

// ---------------------------------------------------------------- version

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const [argVersion, argNotes] = process.argv.slice(2);

function nextPatch(version) {
  const [major, minor, patch] = version.split(".").map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

const version = argVersion ?? nextPatch(pkg.version);
if (!/^\d+\.\d+\.\d+$/.test(version)) die(`Ogiltigt versionsnummer: ${version}`);
if (version === pkg.version) die(`Version ${version} är redan den nuvarande.`);

const notes = argNotes ?? `Mdash ${version}`;

say(`\n  Mdash ${pkg.version} → ${version}\n`);

// ---------------------------------------------------- kontroller före bygget

if (!fs.existsSync(KEY_PATH)) {
  die(
    `Signeringsnyckeln saknas: ${KEY_PATH}\n` +
      `    Utan den kan installerade appar inte verifiera uppdateringen.\n` +
      `    Ny nyckel skapas med: npx tauri signer generate -w "${KEY_PATH}"\n` +
      `    OBS: en ny nyckel gör att redan installerade appar slutar kunna uppdatera sig.`
  );
}

const gh = findGh();
if (capture(gh, ["auth", "status"]) === "" && spawnSync(gh, ["auth", "status"], { shell: true }).status !== 0) {
  die("Du är inte inloggad på GitHub. Kör: gh auth login");
}

const dirty = capture("git", ["status", "--porcelain"]);
if (dirty) say("  Osparade ändringar tas med i versionscommiten:\n" + dirty.split("\n").map((l) => `    ${l}`).join("\n") + "\n");

// ------------------------------------------------------ höj versionsnumret

pkg.version = version;
fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");

const confPath = "src-tauri/tauri.conf.json";
const conf = JSON.parse(fs.readFileSync(confPath, "utf8"));
conf.version = version;
fs.writeFileSync(confPath, JSON.stringify(conf, null, 2) + "\n");

const cargoPath = "src-tauri/Cargo.toml";
const cargo = fs.readFileSync(cargoPath, "utf8");
fs.writeFileSync(
  cargoPath,
  cargo.replace(/^version = "\d+\.\d+\.\d+"$/m, `version = "${version}"`)
);

say("  ✓ Versionsnummer uppdaterade\n");

// -------------------------------------------------------------------- bygg

say("  Bygger och signerar (tar några minuter)…\n");
run("npm", ["run", "bundle"], {
  env: {
    ...process.env,
    TAURI_SIGNING_PRIVATE_KEY: fs.readFileSync(KEY_PATH, "utf8").trim(),
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "",
  },
});

const bundleDir = "src-tauri/target/release/bundle/nsis";
const installer = path.join(bundleDir, `Mdash_${version}_x64-setup.exe`);
const signature = `${installer}.sig`;

if (!fs.existsSync(installer)) die(`Installeraren blev inte byggd: ${installer}`);
if (!fs.existsSync(signature)) {
  die(
    `Signaturen saknas: ${signature}\n` +
      `    Kontrollera att "createUpdaterArtifacts": true står i tauri.conf.json.`
  );
}

// -------------------------------------------------- latest.json som appen läser

const latest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature: fs.readFileSync(signature, "utf8").trim(),
      url: `https://github.com/${REPO}/releases/download/v${version}/Mdash_${version}_x64-setup.exe`,
    },
  },
};

const latestPath = path.join(bundleDir, "latest.json");
fs.writeFileSync(latestPath, JSON.stringify(latest, null, 2) + "\n");
say("\n  ✓ Installerare, signatur och latest.json klara\n");

// ------------------------------------------------------------ git och GitHub

run("git", ["add", "-A"]);
run("git", ["commit", "-m", `Version ${version}`]);
run("git", ["tag", `v${version}`]);
run("git", ["push", "origin", "HEAD", "--tags"]);

say("\n  Laddar upp till GitHub…\n");
run(gh, [
  "release",
  "create",
  `v${version}`,
  `"${installer}"`,
  `"${signature}"`,
  `"${latestPath}"`,
  "--title",
  `"Mdash ${version}"`,
  "--notes",
  `"${notes}"`,
]);

say(
  `\n  ✓ Mdash ${version} är släppt.\n\n` +
    `    Installerade appar ser den nästa gång de startar.\n` +
    `    Installerare: ${installer}\n`
);

// Håll kopian i projektroten aktuell för den som hellre installerar för hand.
try {
  fs.copyFileSync(installer, path.basename(installer));
  say(`    Kopia i projektmappen: ${path.basename(installer)}\n`);
} catch {
  /* Kopian är en bekvämlighet, inte ett krav. */
}

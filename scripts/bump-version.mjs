import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function isValidSemver(version) {
  return typeof version === 'string' && SEMVER_RE.test(version);
}

export function parseSemver(version) {
  const match = SEMVER_RE.exec(version);
  if (!match) {
    throw new Error(`Invalid SemVer "${version}". Expected strict MAJOR.MINOR.PATCH (e.g., 1.2.3).`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function bumpSemver(currentVersion, kind) {
  const { major, minor, patch } = parseSemver(currentVersion);
  if (kind === 'patch') return `${major}.${minor}.${patch + 1}`;
  if (kind === 'minor') return `${major}.${minor + 1}.0`;
  if (kind === 'major') return `${major + 1}.0.0`;
  throw new Error(`Unsupported bump kind "${kind}". Expected patch, minor, or major.`);
}

export function extractCargoPackageVersion(tomlText) {
  const lines = tomlText.split(/\r?\n/);
  let inPackageSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[')) {
      inPackageSection = trimmed === '[package]';
      continue;
    }
    if (!inPackageSection) continue;
    const match = /^version\s*=\s*"([^"]+)"/.exec(trimmed);
    if (match) {
      return match[1];
    }
  }
  throw new Error('Could not find [package] version in Cargo.toml');
}

export function updateCargoTomlVersion(tomlText, nextVersion) {
  parseSemver(nextVersion);
  const eol = tomlText.includes('\r\n') ? '\r\n' : '\n';
  const lines = tomlText.split(/\r?\n/);
  let inPackageSection = false;
  let updated = false;

  const out = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('[')) {
      inPackageSection = trimmed === '[package]';
      return line;
    }
    if (inPackageSection && !updated && /^version\s*=\s*"[^"]+"/.test(trimmed)) {
      updated = true;
      return line.replace(/version\s*=\s*"[^"]+"/, `version = "${nextVersion}"`);
    }
    return line;
  });

  if (!updated) {
    throw new Error('Failed to update [package] version in Cargo.toml');
  }
  return out.join(eol);
}

export function updateCargoLockVersion(lockText, packageName, nextVersion) {
  parseSemver(nextVersion);
  const eol = lockText.includes('\r\n') ? '\r\n' : '\n';
  const lines = lockText.split(/\r?\n/);
  let inTargetPkg = false;
  let updated = false;

  const out = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed === '[[package]]') {
      inTargetPkg = false;
      return line;
    }
    if (trimmed === `name = "${packageName}"`) {
      inTargetPkg = true;
      return line;
    }
    if (inTargetPkg && !updated && /^version\s*=\s*"[^"]+"/.test(trimmed)) {
      updated = true;
      inTargetPkg = false;
      return line.replace(/version\s*=\s*"[^"]+"/, `version = "${nextVersion}"`);
    }
    return line;
  });

  return out.join(eol);
}

function writeAtomic(filePath, content) {
  const tmpPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function detectJsonEol(text) {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

export function checkManifestVersions(rootDir, expectTag = null) {
  const pkgPath = path.join(rootDir, 'package.json');
  const tauriConfPath = path.join(rootDir, 'src-tauri', 'tauri.conf.json');
  const cargoTomlPath = path.join(rootDir, 'src-tauri', 'Cargo.toml');

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
  const cargoVersion = extractCargoPackageVersion(fs.readFileSync(cargoTomlPath, 'utf8'));

  const versions = {
    'package.json': pkg.version,
    'src-tauri/tauri.conf.json': tauriConf.version,
    'src-tauri/Cargo.toml': cargoVersion,
  };

  for (const [file, ver] of Object.entries(versions)) {
    if (!isValidSemver(ver)) {
      throw new Error(`Invalid SemVer "${ver}" in ${file}.`);
    }
  }

  const unique = new Set(Object.values(versions));
  if (unique.size !== 1) {
    const summary = Object.entries(versions)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    throw new Error(`Manifest version mismatch detected: ${summary}`);
  }

  const version = pkg.version;
  if (expectTag) {
    const expected = expectTag.startsWith('v') ? expectTag.slice(1) : expectTag;
    if (!isValidSemver(expected)) {
      throw new Error(`Expected tag "${expectTag}" is not a valid SemVer tag (vMAJOR.MINOR.PATCH).`);
    }
    if (version !== expected) {
      throw new Error(`Tag version "${expectTag}" does not match manifest version "${version}".`);
    }
  }

  return { version, versions };
}

export function syncManifestVersions(rootDir, nextVersion) {
  parseSemver(nextVersion);

  const pkgPath = path.join(rootDir, 'package.json');
  const pkgLockPath = path.join(rootDir, 'package-lock.json');
  const tauriConfPath = path.join(rootDir, 'src-tauri', 'tauri.conf.json');
  const cargoTomlPath = path.join(rootDir, 'src-tauri', 'Cargo.toml');
  const cargoLockPath = path.join(rootDir, 'src-tauri', 'Cargo.lock');

  const pkgRaw = fs.readFileSync(pkgPath, 'utf8');
  const pkgEol = detectJsonEol(pkgRaw);
  const pkgJson = JSON.parse(pkgRaw);
  pkgJson.version = nextVersion;

  const tauriRaw = fs.readFileSync(tauriConfPath, 'utf8');
  const tauriEol = detectJsonEol(tauriRaw);
  const tauriJson = JSON.parse(tauriRaw);
  tauriJson.version = nextVersion;

  const cargoRaw = fs.readFileSync(cargoTomlPath, 'utf8');
  const nextCargoToml = updateCargoTomlVersion(cargoRaw, nextVersion);

  const pendingWrites = [
    { filePath: pkgPath, content: JSON.stringify(pkgJson, null, 2).replace(/\n/g, pkgEol) + pkgEol },
    { filePath: tauriConfPath, content: JSON.stringify(tauriJson, null, 2).replace(/\n/g, tauriEol) + tauriEol },
    { filePath: cargoTomlPath, content: nextCargoToml },
  ];

  if (fs.existsSync(pkgLockPath)) {
    const lockRaw = fs.readFileSync(pkgLockPath, 'utf8');
    const lockEol = detectJsonEol(lockRaw);
    const lockJson = JSON.parse(lockRaw);
    lockJson.version = nextVersion;
    if (lockJson.packages && lockJson.packages['']) {
      lockJson.packages[''].version = nextVersion;
    }
    pendingWrites.push({
      filePath: pkgLockPath,
      content: JSON.stringify(lockJson, null, 2).replace(/\n/g, lockEol) + lockEol,
    });
  }

  if (fs.existsSync(cargoLockPath)) {
    const cargoLockRaw = fs.readFileSync(cargoLockPath, 'utf8');
    const pkgName = pkgJson.name || 'document-viewer';
    pendingWrites.push({
      filePath: cargoLockPath,
      content: updateCargoLockVersion(cargoLockRaw, pkgName, nextVersion),
    });
  }

  for (const item of pendingWrites) {
    writeAtomic(item.filePath, item.content);
  }

  return checkManifestVersions(rootDir);
}

function runCli() {
  const args = process.argv.slice(2);
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

  if (args.includes('--check')) {
    const tagFlagIdx = args.indexOf('--expect-tag');
    const expectTag = tagFlagIdx >= 0 ? args[tagFlagIdx + 1] ?? null : null;
    const result = checkManifestVersions(rootDir, expectTag);
    console.log(`[version:check] All manifests synchronized at v${result.version}`);
    return;
  }

  const createTag = args.includes('--tag');
  const positional = args.filter((a) => !a.startsWith('--'));
  const command = positional[0];

  if (!command) {
    console.error(
      'Usage: node scripts/bump-version.mjs [--check [--expect-tag vX.Y.Z] | patch|minor|major [--tag] | set <X.Y.Z> [--tag]]',
    );
    process.exit(1);
  }

  const { version: currentVersion } = checkManifestVersions(rootDir);
  let targetVersion;

  if (command === 'patch' || command === 'minor' || command === 'major') {
    targetVersion = bumpSemver(currentVersion, command);
  } else if (command === 'set') {
    const explicit = positional[1];
    if (!explicit) {
      throw new Error('Missing target version for "set". Example: npm run version:set -- 0.2.0');
    }
    const normalized = explicit.startsWith('v') ? explicit.slice(1) : explicit;
    parseSemver(normalized);
    targetVersion = normalized;
  } else {
    throw new Error(`Unknown command "${command}".`);
  }

  const updated = syncManifestVersions(rootDir, targetVersion);
  console.log(`[bump-version] Updated all manifests: ${currentVersion} -> ${updated.version}`);

  if (createTag) {
    const tagName = `v${updated.version}`;
    const existing = execFileSync('git', ['tag', '--list', tagName], {
      cwd: rootDir,
      encoding: 'utf8',
    }).trim();
    if (existing) {
      throw new Error(`Git tag "${tagName}" already exists.`);
    }
    execFileSync('git', ['tag', '-a', tagName, '-m', `Release ${tagName}`], {
      cwd: rootDir,
      stdio: 'inherit',
    });
    console.log(`[bump-version] Created annotated Git tag ${tagName}`);
  }
}

const isEntrypoint =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  try {
    runCli();
  } catch (err) {
    console.error(`[bump-version] Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

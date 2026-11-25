import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const pdfjsRoot = path.join(rootDir, 'node_modules', 'pdfjs-dist');
const targetRoot = path.join(rootDir, 'public', 'pdfjs');
const markerFile = path.join(targetRoot, '.sync-marker.json');

if (!fs.existsSync(pdfjsRoot)) {
  console.warn('[sync-pdfjs-assets] node_modules/pdfjs-dist not found yet, skipping.');
  process.exit(0);
}

const pkg = JSON.parse(fs.readFileSync(path.join(pdfjsRoot, 'package.json'), 'utf8'));
const folders = ['cmaps', 'iccs', 'standard_fonts', 'wasm'];

function countFiles(dir) {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      count += countFiles(path.join(dir, entry.name));
    } else if (entry.isFile()) {
      count += 1;
    }
  }
  return count;
}

const sourceCounts = {};
for (const folder of folders) {
  const src = path.join(pdfjsRoot, folder);
  if (fs.existsSync(src)) {
    sourceCounts[folder] = countFiles(src);
  }
}

if (fs.existsSync(markerFile)) {
  try {
    const marker = JSON.parse(fs.readFileSync(markerFile, 'utf8'));
    if (marker.version === pkg.version) {
      let upToDate = true;
      for (const [folder, expected] of Object.entries(sourceCounts)) {
        if (countFiles(path.join(targetRoot, folder)) !== expected) {
          upToDate = false;
          break;
        }
      }
      if (upToDate) {
        process.exit(0);
      }
    }
  } catch {
    // Re-sync if marker cannot be parsed
  }
}

fs.mkdirSync(targetRoot, { recursive: true });
for (const folder of folders) {
  const src = path.join(pdfjsRoot, folder);
  const dst = path.join(targetRoot, folder);
  if (fs.existsSync(src)) {
    fs.rmSync(dst, { recursive: true, force: true });
    fs.cpSync(src, dst, { recursive: true });
  }
}

fs.writeFileSync(
  markerFile,
  JSON.stringify({ version: pkg.version, counts: sourceCounts }, null, 2),
);
console.log(`[sync-pdfjs-assets] Synced offline pdfjs-dist@${pkg.version} assets.`);

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bumpSemver,
  checkManifestVersions,
  isValidSemver,
  syncManifestVersions,
  updateCargoLockVersion,
  updateCargoTomlVersion,
} from '../../scripts/bump-version.mjs';

const tempDirs: string[] = [];

function createTempRepo(version = '0.1.0'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docviewer-semver-'));
  tempDirs.push(dir);
  fs.mkdirSync(path.join(dir, 'src-tauri'), { recursive: true });

  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'document-viewer', version }, null, 2) + '\n',
  );
  fs.writeFileSync(
    path.join(dir, 'package-lock.json'),
    JSON.stringify(
      {
        name: 'document-viewer',
        version,
        packages: { '': { name: 'document-viewer', version } },
      },
      null,
      2,
    ) + '\n',
  );
  fs.writeFileSync(
    path.join(dir, 'src-tauri', 'tauri.conf.json'),
    JSON.stringify({ productName: 'Document Viewer', version }, null, 2) + '\n',
  );
  fs.writeFileSync(
    path.join(dir, 'src-tauri', 'Cargo.toml'),
    `[package]\nname = "document-viewer"\nversion = "${version}"\nedition = "2021"\n\n[dependencies]\nserde = { version = "1", features = ["derive"] }\n`,
  );
  fs.writeFileSync(
    path.join(dir, 'src-tauri', 'Cargo.lock'),
    `[[package]]\nname = "anyhow"\nversion = "1.0.0"\n\n[[package]]\nname = "document-viewer"\nversion = "${version}"\n`,
  );
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('SemVer release tooling', () => {
  it('validates strict SemVer and computes patch/minor/major bumps accurately', () => {
    expect(isValidSemver('0.1.0')).toBe(true);
    expect(isValidSemver('12.34.56')).toBe(true);
    expect(isValidSemver('01.0.0')).toBe(false);
    expect(isValidSemver('v0.1.0')).toBe(false);
    expect(isValidSemver('1.2')).toBe(false);

    expect(bumpSemver('0.1.0', 'patch')).toBe('0.1.1');
    expect(bumpSemver('0.1.9', 'minor')).toBe('0.2.0');
    expect(bumpSemver('0.2.5', 'major')).toBe('1.0.0');
  });

  it('updates only [package] version in Cargo.toml and target package in Cargo.lock', () => {
    const sampleToml = `[package]\nname = "document-viewer"\nversion = "0.1.0"\n\n[dependencies]\nsha2 = { version = "0.10" }\n`;
    const updatedToml = updateCargoTomlVersion(sampleToml, '0.2.0');
    expect(updatedToml).toContain('version = "0.2.0"');
    expect(updatedToml).toContain('sha2 = { version = "0.10" }');

    const sampleLock = `[[package]]\nname = "sha2"\nversion = "0.10.9"\n\n[[package]]\nname = "document-viewer"\nversion = "0.1.0"\n`;
    const updatedLock = updateCargoLockVersion(sampleLock, 'document-viewer', '0.2.0');
    expect(updatedLock).toContain('name = "sha2"\nversion = "0.10.9"');
    expect(updatedLock).toContain('name = "document-viewer"\nversion = "0.2.0"');
  });

  it('synchronizes all manifests atomically and detects drift or tag mismatch', () => {
    const repo = createTempRepo('0.1.0');
    expect(checkManifestVersions(repo, 'v0.1.0').version).toBe('0.1.0');

    const synced = syncManifestVersions(repo, '0.2.0');
    expect(synced.version).toBe('0.2.0');
    expect(checkManifestVersions(repo, 'v0.2.0').version).toBe('0.2.0');

    // Tag mismatch must fail
    expect(() => checkManifestVersions(repo, 'v0.2.1')).toThrow(/does not match/);

    // Drift between manifests must fail
    fs.writeFileSync(
      path.join(repo, 'src-tauri', 'tauri.conf.json'),
      JSON.stringify({ productName: 'Document Viewer', version: '0.3.0' }, null, 2),
    );
    expect(() => checkManifestVersions(repo)).toThrow(/mismatch detected/);
  });
});

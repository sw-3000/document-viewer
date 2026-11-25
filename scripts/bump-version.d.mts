export interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
}

export interface ManifestCheckResult {
  version: string;
  versions: Record<string, string>;
}

export function isValidSemver(version: string): boolean;
export function parseSemver(version: string): ParsedSemver;
export function bumpSemver(
  currentVersion: string,
  kind: 'patch' | 'minor' | 'major',
): string;
export function extractCargoPackageVersion(tomlText: string): string;
export function updateCargoTomlVersion(tomlText: string, nextVersion: string): string;
export function updateCargoLockVersion(
  lockText: string,
  packageName: string,
  nextVersion: string,
): string;
export function checkManifestVersions(
  rootDir: string,
  expectTag?: string | null,
): ManifestCheckResult;
export function syncManifestVersions(
  rootDir: string,
  nextVersion: string,
): ManifestCheckResult;

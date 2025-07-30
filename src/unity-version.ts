import semver = require('semver');
import core = require('@actions/core');

export class UnityVersion {
  private semVer: semver.SemVer;
  constructor(
    public version: string,
    public changeset: string | null | undefined,
    public architecture: 'X86_64' | 'ARM64',
  ) {
    const coercedVersion = semver.coerce(version);
    if (!coercedVersion) {
      throw new Error(`Invalid Unity version: ${version}`);
    }
    this.semVer = coercedVersion;
    if (architecture === 'ARM64' && !this.isArmCompatible()) {
      this.architecture = 'X86_64';
    }
  }

  static compare(a: UnityVersion, b: UnityVersion): number {
    const vA = a.version;
    const vB = b.version;
    return semver.compare(vA, vB, true);
  }

  toString(): string {
    return this.changeset ? `${this.version} (${this.changeset})` : this.version;
  }

  isLegacy(): boolean {
    return semver.major(this.version, { loose: true }) <= 4;
  }

  isArmCompatible(): boolean {
    if (this.semVer.major < 2021) { return false; }
    return semver.compare(this.semVer, '2021.0.0', true) >= 0;
  }

  findMatch(versions: string[]): UnityVersion {
    // Try exact match first
    const exactMatch = versions.find(r => {
      const match = r.match(/(?<version>\d+\.\d+\.\d+[abcfpx]?\d*)/);
      return match && match.groups && match.groups.version === this.version;
    });
    if (exactMatch) {
      core.debug(`Exact match found for ${this.version}`);
      return new UnityVersion(this.version, null, this.architecture);
    }

    // Only fall back to caret range if both minor and patch are 0 (ignoring suffixes)
    const versionParts = this.version.match(/^(\d+)\.(\d+)\.(\d+)/);
    let minorIsZero = false, patchIsZero = false;
    if (versionParts) {
      const [, , minor, patch] = versionParts;
      minorIsZero = minor === '0';
      patchIsZero = patch === '0';
    }
    if (minorIsZero && patchIsZero) {
      const validReleases = versions
        .map(release => semver.coerce(release))
        .filter(release => release && semver.satisfies(release, `^${this.semVer}`))
        .sort((a, b) => semver.compare(b, a));
      core.debug(`Searching for fallback match for ${this.version}:`);
      validReleases.forEach(release => {
        core.debug(`  > ${release}`);
      });
      for (const release of validReleases) {
        if (!release) { continue; }
        const originalRelease = versions.find(r => r.includes(release.version));
        if (!originalRelease) { continue; }
        const match = originalRelease.match(/(?<version>\d+\.\d+\.\d+[abcfpx]?\d*)\s*(?:\((?<arch>Apple silicon|Intel)\))?/);
        if (!(match && match.groups && match.groups.version)) { continue; }
        if ((this.version.includes('a') && match.groups.version.includes('a')) ||
          (this.version.includes('b') && match.groups.version.includes('b')) ||
          match.groups.version.includes('f')) {
          core.debug(`Found fallback Unity ${match.groups.version}`);
          return new UnityVersion(match.groups.version, null, this.architecture);
        }
      }
    }
    core.debug(`No matching Unity version found for ${this.version}`);
    return this;
  }

  satisfies(version: string): boolean {
    const coercedVersion = semver.coerce(version);
    if (!coercedVersion) {
      throw new Error(`Invalid version to check against: ${version}`);
    }
    return semver.satisfies(coercedVersion, `^${this.semVer}`);
  }
}

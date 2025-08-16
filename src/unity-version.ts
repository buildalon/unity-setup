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
    const exactMatch = versions.find(release => {
      // Only match fully formed Unity versions (e.g., 2021.3.5f1, 2022.1.0b12)
      const match = release.match(/(?<version>\d{4}\.\d+\.\d+[abcfpx]\d+)/);
      return match && match.groups && match.groups.version === this.version;
    });

    if (exactMatch) {
      core.debug(`Exact match found for ${this.version}`);
      return new UnityVersion(this.version, null, this.architecture);
    }

    // if the input version contains `.x` or `.0` then we need to do a fallback match
    const versionParts = this.version.match(/^(\d+)\.(\d+)\.(\d+)/);
    let minorIsZero = false, patchIsZero = false;

    if (versionParts) {
      const [, , minor, patch] = versionParts;
      minorIsZero = minor === '0';
      patchIsZero = patch === '0';
    }

    if (minorIsZero && patchIsZero) {
      // Only consider fully formed Unity versions with 'f' suffix
      const releases = versions
        .map(release => {
          const match = release.match(/(?<version>\d{4}\.\d+\.\d+f\d+)/);
          return match && match.groups ? match.groups.version : null;
        })
        .filter(Boolean)
        .filter(version => semver.satisfies(semver.coerce(version)!, `^${this.semVer}`));

      // Sort by full Unity version string (descending)
      releases.sort((a, b) => {
        // Compare by year, minor, patch, then f number
        const parse = (v: string) => {
          const match = v.match(/(\d{4})\.(\d+)\.(\d+)f(\d+)/);
          return match ? [parseInt(match[1]), parseInt(match[2]), parseInt(match[3]), parseInt(match[4])] : [0, 0, 0, 0];
        };
        const [ay, am, ap, af] = parse(a);
        const [by, bm, bp, bf] = parse(b);
        if (ay !== by) return by - ay;
        if (am !== bm) return bm - am;
        if (ap !== bp) return bp - ap;
        return bf - af;
      });

      core.debug(`Searching for fallback match for ${this.version}:`);
      releases.forEach(version => {
        core.debug(`  > ${version}`);
      });

      if (releases.length > 0) {
        core.debug(`Found fallback Unity ${releases[0]}`);
        return new UnityVersion(releases[0], null, this.architecture);
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

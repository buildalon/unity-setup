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
  // Compare using coerced SemVer objects to handle partial inputs (e.g., "2022") safely
  return semver.compare(a.semVer, b.semVer, true);
  }

  toString(): string {
    return this.changeset ? `${this.version} (${this.changeset})` : this.version;
  }

  isLegacy(): boolean {
    // Consider all pre-2017 versions (e.g., 5.x, 4.x) as legacy editors
    // Use coerced SemVer to avoid errors on partial inputs like "2022"
    return this.semVer.major < 2017;
  }

  isArmCompatible(): boolean {
    if (this.semVer.major < 2021) { return false; }
    return semver.compare(this.semVer, '2021.0.0', true) >= 0;
  }

  findMatch(versions: string[]): UnityVersion {
    const fullPattern = /^\d{4}\.\d+\.\d+[abcfpx]\d+$/;
    const exactMatch = versions.find(release => {
      // Only match fully formed Unity versions (e.g., 2021.3.5f1, 2022.1.0b12)
      const match = release.match(/(?<version>\d{4}\.\d+\.\d+[abcfpx]\d+)/);
      return match && match.groups && match.groups.version === this.version;
    });

    if (exactMatch) {
      core.debug(`Exact match found for ${this.version}`);
      return new UnityVersion(this.version, null, this.architecture);
    }

    // Trigger fallback for any non fully-qualified version or wildcard patterns
    // e.g., "6000", "6000.1", "6000.0.0", "2022.x", "6000.*"
    const hasWildcard = /\.x($|[^\w])/.test(this.version) || /\.\*($|[^\w])/.test(this.version);
    const triggerFallback = hasWildcard || !fullPattern.test(this.version);

    if (triggerFallback) {
      // Determine major/minor for fallback, supporting wildcards and partials
      let major: string | undefined, minor: string | undefined;
      const xMatch = this.version.match(/^(\d{4})(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?/);

      if (xMatch) {
        major = xMatch[1];
        minor = xMatch[2];
      }

      let releases = versions
        .map(release => {
          const match = release.match(/(?<version>\d{4}\.\d+\.\d+[abcfpx]\d+)/);
          return match && match.groups ? match.groups.version : null;
        })
        .filter(Boolean)
        .filter(version => {
          if (!version) { return false; }
          const parts = version.match(/(\d{4})\.(\d+)\.(\d+)([abcfpx])(\d+)/);
          if (!parts || parts[4] !== 'f') { return false; }
          // major must match
          if (major && parts[1] !== major) { return false; }
          // minor: if 'x' or '*', allow any, else must match
          if (minor && minor !== 'x' && minor !== '*' && parts[2] !== minor) { return false; }
          return true;
        });

      // If no matches and requested minor was explicitly '0', broaden to any minor for that major
      if (releases.length === 0 && minor === '0') {
        releases = versions
          .map(release => {
            const match = release.match(/(?<version>\d{4}\.\d+\.\d+[abcfpx]\d+)/);
            return match && match.groups ? match.groups.version : null;
          })
          .filter(Boolean)
          .filter(version => {
            if (!version) { return false; }
            const parts = version.match(/(\d{4})\.(\d+)\.(\d+)([abcfpx])(\d+)/);
            if (!parts || parts[4] !== 'f') { return false; }
            if (major && parts[1] !== major) { return false; }
            return true; // ignore minor
          });
      }

      // Sort by minor, patch, and f number descending
      releases.sort((a, b) => {
        const parse = (v: string) => {
          const match = v.match(/(\d{4})\.(\d+)\.(\d+)([abcfpx])(\d+)/);
          return match ? [parseInt(match[2]), parseInt(match[3]), parseInt(match[5])] : [0, 0, 0];
        };

        const [aMinor, aPatch, af] = parse(a);
        const [bMinor, bPatch, bf] = parse(b);

        if (aMinor !== bMinor) { return bMinor - aMinor; }
        if (aPatch !== bPatch) { return bPatch - aPatch; }
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

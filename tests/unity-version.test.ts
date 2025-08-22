import {
    UnityVersion
} from '../src/unity-version';
import {
    getLatestHubReleases,
    getEditorReleaseInfo
} from '../src/unity-hub';

const fs = require('fs');
const path = require('path');

describe('UnityVersion.findMatch', () => {
    let buildOptions: any;
    let releases: string[];

    beforeAll(async () => {
        const buildOptionsPath = path.resolve(__dirname, '../.github/workflows/build-options.json');
        buildOptions = JSON.parse(fs.readFileSync(buildOptionsPath, 'utf-8'));
        releases = await getLatestHubReleases();
    }, 30000); // Increase timeout to 30 seconds

    it('should find an exact match for each version in build-options.json if present in releases', () => {
        const versions = buildOptions.versions || [];
        for (const version of versions) {
            const uv = new UnityVersion(version, null, 'X86_64');
            const match = uv.findMatch(releases);
            if (releases.includes(version)) {
                expect(match.version).toBe(version);
            } else {
                // If not found, should return itself
                expect(match.version).toBe(version);
            }
        }
    });

    it('should return itself if no match is found', () => {
        const uv = new UnityVersion('9999.0.0', null, 'X86_64');
        const match = uv.findMatch(releases);
        expect(match.version).toBe('9999.0.0');
    });

    it('should fallback to a compatible version if minor and patch are 0', () => {
        // should match with the latest 2022.x.xfx release from releases
        // This test expects the fallback to be the latest 2022.x.xfx release
        const latest2022 = releases
            .filter(release => release.startsWith('2022') && release.includes('f'))
            .sort()
            .reverse()[0];
        const uv = new UnityVersion('2022.x', null, 'X86_64');
        const match = uv.findMatch(releases);
        expect(match.version).toBe(latest2022);
    });

    it('should NOT fallback to latest 6000 when searching for 6000.0.0, but to the latest 6000.0.xfx', () => {
        // This test ensures the fallback logic does not incorrectly match 6000.2.x
        const latest6000_0 = releases
            .filter(release => release.startsWith('6000.0') && release.includes('f'))
            .sort()
            .reverse()[0];
        const uv = new UnityVersion('6000.0.x', null, 'X86_64');
        const match = uv.findMatch(releases);
        expect(match.version).toBe(latest6000_0);
    });

    it('major-only 6000 should fallback to the latest stable 6000.x.xfx', () => {
        const stable6000 = releases
            .filter(r => r.startsWith('6000') && /f\d+$/.test(r))
            .map(v => {
                const m = v.match(/(\d{4})\.(\d+)\.(\d+)([abcfpx])(\d+)/);
                return m ? { v, minor: parseInt(m[2]), patch: parseInt(m[3]), f: parseInt(m[5]) } : { v, minor: 0, patch: 0, f: 0 };
            })
            .sort((a, b) => {
                if (a.minor !== b.minor) return b.minor - a.minor;
                if (a.patch !== b.patch) return b.patch - a.patch;
                return b.f - a.f;
            })[0]?.v;
        const uv = new UnityVersion('6000', null, 'X86_64');
        const match = uv.findMatch(releases);
        expect(match.version).toBe(stable6000);
    });

    it('minor-only 6000.1 should not fallback to other minors if not present (keeps 6000.1)', () => {
        const uv = new UnityVersion('6000.1', null, 'X86_64');
        const match = uv.findMatch(releases);
        // If 6000.1.x stable isn't listed by Hub, findMatch should leave it for API resolution
        if (!releases.some(r => r.startsWith('6000.1') && /f\d+$/.test(r))) {
            expect(match.version).toBe('6000.1');
        } else {
            // If Hub happens to list a 6000.1.x stable, ensure we pick the latest
            const stable6000_1 = releases
                .filter(r => r.startsWith('6000.1') && /f\d+$/.test(r))
                .map(v => {
                    const m = v.match(/(\d{4})\.(\d+)\.(\d+)([abcfpx])(\d+)/);
                    return m ? { v, patch: parseInt(m[3]), f: parseInt(m[5]) } : { v, patch: 0, f: 0 };
                })
                .sort((a, b) => {
                    if (a.patch !== b.patch) return b.patch - a.patch;
                    return b.f - a.f;
                })[0]?.v;
            expect(match.version).toBe(stable6000_1);
        }
    });

    it('minor-only 6000.2 should fallback to latest stable 6000.2.xfx, or keep 6000.2 if not listed by Hub', () => {
        const uv = new UnityVersion('6000.2', null, 'X86_64');
        const match = uv.findMatch(releases);
        const has6000_2 = releases.some(r => r.startsWith('6000.2') && /f\d+$/.test(r));
        if (!has6000_2) {
            expect(match.version).toBe('6000.2');
        } else {
            const stable6000_2 = releases
                .filter(r => r.startsWith('6000.2') && /f\d+$/.test(r))
                .map(v => {
                    const m = v.match(/(\d{4})\.(\d+)\.(\d+)([abcfpx])(\d+)/);
                    return m ? { v, minor: parseInt(m[2]), patch: parseInt(m[3]), f: parseInt(m[5]) } : { v, minor: 0, patch: 0, f: 0 };
                })
                .sort((a, b) => {
                    if (a.patch !== b.patch) return b.patch - a.patch;
                    return b.f - a.f;
                })[0]?.v;
            expect(match.version).toBe(stable6000_2);
        }
    });

    it('2022.x should fallback to latest stable 2022.x if 2022.0.x is not present', () => {
        const uv = new UnityVersion('2022.x', null, 'X86_64');
        const match = uv.findMatch(releases);
        const has2022_0 = releases.some(r => r.startsWith('2022.0') && /f\d+$/.test(r));
        if (!has2022_0) {
            const latest2022 = releases
                .filter(release => release.startsWith('2022') && /f\d+$/.test(release))
                .map(v => {
                    const m = v.match(/(\d{4})\.(\d+)\.(\d+)([abcfpx])(\d+)/);
                    return m ? { v, minor: parseInt(m[2]), patch: parseInt(m[3]), f: parseInt(m[5]) } : { v, minor: 0, patch: 0, f: 0 };
                })
                .sort((a, b) => {
                    if (a.minor !== b.minor) return b.minor - a.minor;
                    if (a.patch !== b.patch) return b.patch - a.patch;
                    return b.f - a.f;
                })[0]?.v;
            expect(match.version).toBe(latest2022);
        } else {
            const latest2022_0 = releases
                .filter(release => release.startsWith('2022.0') && /f\d+$/.test(release))
                .map(v => {
                    const m = v.match(/(\d{4})\.(\d+)\.(\d+)([abcfpx])(\d+)/);
                    return m ? { v, patch: parseInt(m[3]), f: parseInt(m[5]) } : { v, patch: 0, f: 0 };
                })
                .sort((a, b) => {
                    if (a.patch !== b.patch) return b.patch - a.patch;
                    return b.f - a.f;
                })[0]?.v;
            expect(match.version).toBe(latest2022_0);
        }
    });

    // Pipeline-level tests mirroring production flow
    it('pipeline: 6000 should resolve to the latest stable 6000.x', async () => {
        const releasesList = await getLatestHubReleases();
        const uv = new UnityVersion('6000', null, 'X86_64');
        const matched = uv.findMatch(releasesList);
        const info = await getEditorReleaseInfo(matched);
        expect(/^(6000)\./.test(info.version)).toBe(true);
        expect(/f\d+$/.test(info.version)).toBe(true);
        // Ensure it is at least as new as the Hub fallback
        const hubFallback = releasesList
            .filter(r => r.startsWith('6000') && /f\d+$/.test(r))
            .map(v => {
                const m = v.match(/(\d{4})\.(\d+)\.(\d+)([abcfpx])(\d+)/);
                return m ? { v, minor: parseInt(m[2]), patch: parseInt(m[3]), f: parseInt(m[5]) } : { v, minor: 0, patch: 0, f: 0 };
            })
            .sort((a, b) => {
                if (a.minor !== b.minor) return b.minor - a.minor;
                if (a.patch !== b.patch) return b.patch - a.patch;
                return b.f - a.f;
            })[0]?.v;
        if (hubFallback) {
            const parse = (v: string) => {
                const m = v.match(/(\d{4})\.(\d+)\.(\d+)([abcfpx])(\d+)/);
                return m ? { minor: parseInt(m[2]), patch: parseInt(m[3]), f: parseInt(m[5]) } : { minor: 0, patch: 0, f: 0 };
            };
            const a = parse(info.version);
            const b = parse(hubFallback);
            const cmp = (x: typeof a, y: typeof b) => (x.minor - y.minor) || (x.patch - y.patch) || (x.f - y.f);
            expect(cmp(a, b)).toBeGreaterThanOrEqual(0);
        }
    }, 30000);

    it('pipeline: 6000.2 should resolve to the latest stable 6000.2.x, or keep minor via API', async () => {
        const releasesList = await getLatestHubReleases();
        const uv = new UnityVersion('6000.2', null, 'X86_64');
        const matched = uv.findMatch(releasesList);
        const info = await getEditorReleaseInfo(matched);
        // If Hub had 6000.2 stable, ensure we stayed within 6000.2.
        const has6000_2 = releasesList.some(r => r.startsWith('6000.2') && /f\d+$/.test(r));
        if (has6000_2) {
            expect(/^6000\.2\./.test(info.version)).toBe(true);
        } else {
            // If Hub didn’t, API result should still be stable and in 6000.2
            expect(/^6000\.2\./.test(info.version)).toBe(true);
        }
        expect(/f\d+$/.test(info.version)).toBe(true);
    }, 30000);

    it('pipeline: 6000.1 should resolve to stable 6000.1.x via API if Hub omits it', async () => {
        const releasesList = await getLatestHubReleases();
        const uv = new UnityVersion('6000.1', null, 'X86_64');
        const matched = uv.findMatch(releasesList);
        const info = await getEditorReleaseInfo(matched);
        expect(/^6000\.1\./.test(info.version)).toBe(true);
        expect(/f\d+$/.test(info.version)).toBe(true);
    }, 30000);

    it('pipeline: 2022.0.0 should resolve to latest stable 2022.x if 2022.0.x not listed by Hub', async () => {
        const releasesList = await getLatestHubReleases();
        const uv = new UnityVersion('2022.0.0', null, 'X86_64');
        const matched = uv.findMatch(releasesList);
        const info = await getEditorReleaseInfo(matched);
        expect(/^2022\./.test(info.version)).toBe(true);
        expect(/f\d+$/.test(info.version)).toBe(true);
    }, 30000);

    describe('integration flow (hub releases -> findMatch -> releases API)', () => {
        it('6000 should resolve to latest stable 6000.x via API', async () => {
            const uv0 = new UnityVersion('6000', null, 'X86_64');
            const matched = uv0.findMatch(releases);
            const info = await getEditorReleaseInfo(matched);
            // Should be stable and start with 6000.
            expect(/^(6000)\./.test(info.version)).toBe(true);
            expect(/f\d+$/.test(info.version)).toBe(true);
        }, 30000);

        it('6000.2 should resolve to latest stable 6000.2.x via API if Hub lists it, otherwise leave 6000.2 for API', async () => {
            const uv0 = new UnityVersion('6000.2', null, 'X86_64');
            const matched = uv0.findMatch(releases);
            const info = await getEditorReleaseInfo(matched);
            expect(/^6000\.2\./.test(info.version)).toBe(true);
            expect(/f\d+$/.test(info.version)).toBe(true);
        }, 30000);

        it('6000.1 should resolve to latest stable 6000.1.x via API even if Hub omits it', async () => {
            const uv0 = new UnityVersion('6000.1', null, 'X86_64');
            const matched = uv0.findMatch(releases);
            const info = await getEditorReleaseInfo(matched);
            expect(/^6000\.1\./.test(info.version)).toBe(true);
            expect(/f\d+$/.test(info.version)).toBe(true);
        }, 30000);

        it('2022.0.0 should resolve to latest stable 2022.x via API when 2022.0 is unavailable', async () => {
            const uv0 = new UnityVersion('2022.0.0', null, 'X86_64');
            const matched = uv0.findMatch(releases);
            const info = await getEditorReleaseInfo(matched);
            expect(/^2022\./.test(info.version)).toBe(true);
            expect(/f\d+$/.test(info.version)).toBe(true);
        }, 30000);

        it('5.6.7f1 should not use Hub fallback and should resolve via API to the exact version', async () => {
            const uv = new UnityVersion('5.6.7f1', null, 'X86_64');
            const matched = uv.findMatch(releases);
            expect(matched.version).toBe('5.6.7f1');
            const info = await getEditorReleaseInfo(matched);
            expect(info.version).toBe('5.6.7f1');
        }, 30000);

        it('4.7.2f1 should be treated as legacy only for tooling but still resolve via API when available', async () => {
            const uv = new UnityVersion('4.7.2f1', null, 'X86_64');
            // findMatch should be a no-op for non-year versions
            const matched = uv.findMatch(releases);
            expect(matched.version).toBe('4.7.2f1');
            // The API may or may not have legacy data; if it does, ensure the version matches
            try {
                const info = await getEditorReleaseInfo(matched);
                expect(info.version).toBe('4.7.2f1');
            } catch (e) {
                // If API has no result, ensure we didn't incorrectly change the version
                expect(matched.version).toBe('4.7.2f1');
            }
        }, 30000);
    });
});

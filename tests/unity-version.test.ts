import {
    UnityVersion
} from '../src/unity-version';
import {
    getLatestHubReleases
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
        const uv = new UnityVersion('6000.0.0', null, 'X86_64');
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

    it('minor-only 6000.2 should fallback to the latest stable 6000.2.xfx', () => {
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
        const uv = new UnityVersion('6000.2', null, 'X86_64');
        const match = uv.findMatch(releases);
        expect(match.version).toBe(stable6000_2);
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
});

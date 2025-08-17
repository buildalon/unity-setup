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

    it('should NOT fallback to 6000.2.x when searching for 6000.0.0, but to the latest 6000.0.xfx', () => {
        // This test ensures the fallback logic does not incorrectly match 6000.2.x
        const latest6000_0 = releases
            .filter(release => release.startsWith('6000.0') && release.includes('f'))
            .sort()
            .reverse()[0];
        const uv = new UnityVersion('6000.0.0', null, 'X86_64');
        const match = uv.findMatch(releases);
        expect(match.version).toBe(latest6000_0);
    });
});

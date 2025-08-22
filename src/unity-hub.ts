
import asar = require('@electron/asar');
import core = require('@actions/core');
import exec = require('@actions/exec');
import semver = require('semver');
import yaml = require('yaml');
import path = require('path');
import fs = require('fs');
import {
    GetHubRootPath,
    GetEditorRootPath,
    ReadFileContents,
    RemovePath,
    GetCurrentPlatform
} from './utility';
import {
    UnityVersion
} from './unity-version';
import {
    UnityReleasesClient,
    GetUnityReleasesData,
    UnityRelease
} from '@rage-against-the-pixel/unity-releases-api'

const unityHub = init();
let hubPath = unityHub.hubPath;

function init(): { hubPath: string, editorRootPath: string, editorFileExtension: string } {
    switch (process.platform) {
        case 'win32':
            return {
                hubPath: 'C:/Program Files/Unity Hub/Unity Hub.exe',
                editorRootPath: 'C:/Program Files/Unity/Hub/Editor/',
                editorFileExtension: '/Editor/Unity.exe',
            }
        case 'darwin':
            return {
                hubPath: '/Applications/Unity Hub.app/Contents/MacOS/Unity Hub',
                editorRootPath: '/Applications/Unity/Hub/Editor/',
                editorFileExtension: '/Unity.app/Contents/MacOS/Unity',
            }
        case 'linux':
            return {
                hubPath: '/opt/unityhub/unityhub',
                editorRootPath: `${process.env.HOME}/Unity/Hub/Editor/`,
                editorFileExtension: '/Editor/Unity',
            }
    }
}

export async function Get(): Promise<string> {
    try {
        await fs.promises.access(hubPath, fs.constants.X_OK);
    } catch (error) {
        hubPath = await installUnityHub();
    }
    const hubVersion: semver.SemVer | undefined = await getInstalledHubVersion();
    if (!semver.valid(hubVersion)) {
        throw new Error(`Failed to get installed Unity Hub version ${hubVersion}!`);
    }
    core.info(`Unity Hub Version:\n  > ${hubVersion}`);
    const latestHubVersion: semver.SemVer | undefined = await getLatestHubVersion();
    if (!semver.valid(latestHubVersion)) {
        throw new Error(`Failed to get latest Unity Hub version!`);
    }
    core.debug(`Latest Unity Hub Version:\n  > ${latestHubVersion}`);
    core.debug(`Comparing versions:\n  > ${hubVersion} < ${latestHubVersion} => ${semver.compare(hubVersion, latestHubVersion)}`);
    if (semver.compare(hubVersion, latestHubVersion) < 0) {
        core.info(`Installing Latest Unity Hub Version:\n  > ${latestHubVersion}`);
        if (process.platform !== 'linux') {
            core.info(`Removing previous Unity Hub version:\n  > ${hubVersion}`);
            await RemovePath(hubPath);
            hubPath = await installUnityHub();
        } else {
            const scriptPath = path.join(__dirname, 'update-unityhub-linux.sh');
            const exitCode = await exec.exec('sh', [scriptPath]);
            if (exitCode !== 0) {
                throw new Error(`Failed to install Unity Hub: ${exitCode}`);
            }
        }
    }
    core.info(`Unity Hub Path:\n  > "${hubPath}"`);
    core.exportVariable('UNITY_HUB_PATH', hubPath);
    core.startGroup('Unity Hub Options');
    try {
        await execUnityHub(['help']);
    } finally {
        core.endGroup();
    }
    return hubPath;
}

export async function SetInstallPath(installPath: string): Promise<void> {
    await fs.promises.mkdir(installPath, { recursive: true });
    await execUnityHub(["install-path", "--set", installPath]);
}

async function getInstallPath(): Promise<string> {
    const result = (await execUnityHub(["install-path", "--get"])).trim();
    if (!result || result.length === 0) {
        throw new Error(`Failed to get Unity Hub install path!`);
    }
    return result;
}

async function addEditorPathToHub(editorPath: string): Promise<void> {
    await fs.promises.access(editorPath, fs.constants.R_OK);
    await execUnityHub(["install-path", "--add", editorPath]);
}

async function installUnityHub(): Promise<string> {
    let exitCode = undefined;
    switch (process.platform) {
        case 'win32':
            {
                const scriptPath = path.normalize(path.join(__dirname, 'install-unityhub-windows.ps1'));
                exitCode = await exec.exec('pwsh', [scriptPath]);
                if (exitCode !== 0) {
                    throw new Error(`Failed to install Unity Hub: ${exitCode}`);
                }
                await fs.promises.access(unityHub.hubPath, fs.constants.X_OK);
                return unityHub.hubPath;
            }
        case 'darwin':
            {
                const scriptPath = path.join(__dirname, 'install-unityhub-macos.sh');
                exitCode = await exec.exec('sh', [scriptPath]);
                if (exitCode !== 0) {
                    throw new Error(`Failed to install Unity Hub: ${exitCode}`);
                }
                await fs.promises.access(unityHub.hubPath, fs.constants.X_OK);
                return unityHub.hubPath;
            }
        case 'linux':
            {
                const scriptPath = path.join(__dirname, 'install-unityhub-linux.sh');
                let output = '';
                exitCode = await exec.exec('sh', [scriptPath], {
                    listeners: {
                        stdout: (data) => {
                            output += data.toString();
                        },
                        stderr: (data) => {
                            output += data.toString();
                        }
                    }
                });
                if (exitCode !== 0) {
                    throw new Error(`Failed to install Unity Hub: ${exitCode}`);
                }
                const hubPath = output.match(/UNITY_HUB (.+)/)[1];
                await fs.promises.access(hubPath, fs.constants.X_OK);
                return hubPath;
            }
    }
}

async function getInstalledHubVersion(): Promise<semver.SemVer | undefined> {
    try {
        let asarPath = undefined;
        const baseHubPath = await GetHubRootPath(hubPath);
        switch (process.platform) {
            case 'darwin':
                asarPath = path.join(baseHubPath, 'Contents', 'Resources', 'app.asar');
                break;
            default:
                asarPath = path.join(baseHubPath, 'resources', 'app.asar');
                break;
        }
        await fs.promises.access(asarPath, fs.constants.R_OK);
        const fileBuffer = asar.extractFile(asarPath, 'package.json');
        const packageJson = JSON.parse(fileBuffer.toString());
        return semver.coerce(packageJson.version);
    } catch (error) {
        core.error(error);
        return undefined;
    }
}

async function getLatestHubVersion(): Promise<semver.SemVer | undefined> {
    try {
        let url = undefined;
        switch (process.platform) {
            case 'win32':
                url = 'https://public-cdn.cloud.unity3d.com/hub/prod/latest.yml';
                break;
            case 'darwin':
                url = 'https://public-cdn.cloud.unity3d.com/hub/prod/latest-mac.yml';
                break;
            case 'linux':
                url = 'https://public-cdn.cloud.unity3d.com/hub/prod/latest-linux.yml';
                break;
        }
        const response = await fetch(url);
        const data = await response.text();
        const parsed = yaml.parse(data);
        const version = semver.coerce(parsed.version);
        return version;
    } catch (error) {
        core.error(error);
        return undefined;
    }
}

const ignoredLines = [
    `This error originated either by throwing inside of an async function without a catch block`,
    `Unexpected error attempting to determine if executable file exists`,
    `dri3 extension not supported`,
    `Failed to connect to the bus:`,
    `Checking for beta autoupdate feature for deb/rpm distributions`,
    `Found package-type: deb`,
    `XPC error for connection com.apple.backupd.sandbox.xpc: Connection invalid`
];

async function execUnityHub(args: string[]): Promise<string> {
    if (!hubPath) {
        throw new Error('Unity Hub Path is not set!');
    }
    let output = '';
    switch (process.platform) {
        case 'win32': // "C:/Program Files/Unity Hub/Unity Hub.exe" -- --headless help
        case 'darwin': // "/Applications/Unity Hub.app/Contents/MacOS/Unity Hub" -- --headless help
            core.info(`[command]"${hubPath}" -- --headless ${args.join(' ')}`);
            await exec.exec(`"${hubPath}"`, ['--', '--headless', ...args], {
                listeners: {
                    stdout: (data) => { appendOutput(data.toString()); },
                    stderr: (data) => { appendOutput(data.toString()); },
                },
                ignoreReturnCode: true,
                silent: true
            });
            break;
        case 'linux': // unity-hub --headless help
            core.info(`[command]unity-hub --headless ${args.join(' ')}`);
            await exec.exec('unity-hub', ['--headless', ...args], {
                listeners: {
                    stdout: (data) => { appendOutput(data.toString()); },
                    stderr: (data) => { appendOutput(data.toString()); },
                },
                ignoreReturnCode: true,
                silent: true
            });
            break;
    }
    function appendOutput(line: string) {
        if (line && line.trim().length > 0) {
            if (ignoredLines.some(ignored => line.includes(ignored))) {
                return;
            }
            core.info(line);
            output += `${line}\n`;
        }
    }
    const match = output.match(/Assertion (?<assert>.+) failed/g);
    if (match ||
        output.includes('async hook stack has become corrupted')) {
        core.warning(`Install failed, retrying...`);
        return await execUnityHub(args);
    }
    if (output.includes('Error:')) {
        const error = output.match(/Error: (.+)/)[1];
        switch (error) {
            case 'No modules found to install.':
                return output;
            default:
                throw new Error(`Failed to execute Unity Hub: ${error}`);
        }
    }
    return output;
}

const retryErrorMessages = [
    'Editor already installed in this location',
    'failed to download. Error given: Request timeout'
];

export async function UnityEditor(unityVersion: UnityVersion, modules: string[]): Promise<string> {
    core.info(`Getting release info for Unity ${unityVersion.toString()}...`);
    let editorPath = await checkInstalledEditors(unityVersion, false);
    if (!unityVersion.isLegacy() && !editorPath) {
        try {
            const releases = await getLatestHubReleases();
            unityVersion = unityVersion.findMatch(releases);
            const unityReleaseInfo: UnityRelease = await getEditorReleaseInfo(unityVersion);
            unityVersion = new UnityVersion(unityReleaseInfo.version, unityReleaseInfo.shortRevision, unityVersion.architecture);
        } catch (error) {
            core.warning(`Failed to get Unity release info for ${unityVersion.toString()}! falling back to legacy search...\n${error}`);
            unityVersion = await fallbackVersionLookup(unityVersion);
        }
    }
    let installPath: string | null = null;
    if (!editorPath) {
        try {
            installPath = await installUnity(unityVersion, modules);
        } catch (error) {
            if (retryErrorMessages.some(msg => error.message.includes(msg))) {
                if (editorPath) {
                    await RemovePath(editorPath);
                }
                if (installPath) {
                    await RemovePath(installPath);
                }
                installPath = await installUnity(unityVersion, modules);
            } else {
                throw error;
            }
        }
        editorPath = await checkInstalledEditors(unityVersion, true, installPath);
    }
    await fs.promises.access(editorPath, fs.constants.X_OK);
    core.info(`Unity Editor Path:\n  > "${editorPath}"`);
    await patchBeeBackend(editorPath);
    if (unityVersion.isLegacy() || modules.length === 0) {
        return editorPath;
    }
    try {
        core.startGroup(`Checking installed modules for Unity ${unityVersion.toString()}...`);
        const [installedModules, additionalModules] = await checkEditorModules(editorPath, unityVersion, modules);
        if (installedModules && installedModules.length > 0) {
            core.info(`Installed Modules:`);
            for (const module of installedModules) {
                core.info(`  > ${module}`);
            }
        }
        if (additionalModules && additionalModules.length > 0) {
            core.info(`Additional Modules:`);
            for (const module of additionalModules) {
                core.info(`  > ${module}`);
            }
        }
    } catch (error) {
        if (error.message.includes(`No modules found`)) {
            await RemovePath(editorPath);
            await UnityEditor(unityVersion, modules);
        }
    } finally {
        core.endGroup();
    }
    return editorPath;
}

/**
 * Patches the Bee Backend for Unity Linux Editor.
 * https://discussions.unity.com/t/linux-editor-stuck-on-loading-because-of-bee-backend-w-workaround/854480
 * @param editorPath
 */
async function patchBeeBackend(editorPath: string): Promise<void> {
    if (process.platform === 'linux') {
        const dataPath = path.join(path.dirname(editorPath), 'Data');
        const beeBackend = path.join(dataPath, 'bee_backend');
        const dotBeeBackend = path.join(dataPath, '.bee_backend');
        if (fs.existsSync(beeBackend) && !fs.existsSync(dotBeeBackend)) {
            core.debug(`Patching Unity Linux Editor for Bee Backend...`);
            await fs.promises.rename(beeBackend, dotBeeBackend);
            const wrapperSource = path.join(__dirname, 'linux-bee-backend-wrapper.sh');
            await fs.promises.copyFile(wrapperSource, beeBackend);
            await fs.promises.chmod(beeBackend, 0o755);
        }
    }
}

export async function getLatestHubReleases(): Promise<string[]> {
    // Normalize output to bare version strings (e.g., 2022.3.62f1)
    // Unity Hub can return lines like:
    //  - "6000.0.56f1 (Apple silicon)"
    //  - "2022.3.62f1 installed at C:\\..."
    //  - "2022.3.62f1, installed at ..." (older format)
    // We extract the first version token and discard the rest.
    const versionRegex = /(\d{1,4})\.(\d+)\.(\d+)([abcfpx])(\d+)/;
    return (await execUnityHub([`editors`, `--releases`]))
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map(line => {
            const match = line.match(versionRegex);
            return match ? match[0] : '';
        })
        .filter(v => v.length > 0);
}

async function installUnity(unityVersion: UnityVersion, modules: string[]): Promise<string | undefined> {
    if (unityVersion.isLegacy()) {
        return await installUnity4x(unityVersion);
    }
    core.startGroup(`Installing Unity ${unityVersion.toString()}...`);
    const args = ['install', '--version', unityVersion.version];
    if (unityVersion.changeset) {
        args.push('--changeset', unityVersion.changeset);
    }
    if (unityVersion.architecture) {
        args.push('-a', unityVersion.architecture.toLowerCase());
    }
    if (modules.length > 0) {
        for (const module of modules) {
            core.info(`  > with module: ${module}`);
            args.push('-m', module);
        }

        args.push('--cm');
    }
    try {
        const output = await execUnityHub(args);
        if (output.includes(`Error while installing an editor or a module from changeset`)) {
            throw new Error(`Failed to install Unity ${unityVersion.toString()}`);
        }
    } finally {
        core.endGroup();
    }
}

async function installUnity4x(unityVersion: UnityVersion): Promise<string> {
    const installDir = await getInstallPath();
    switch (process.platform) {
        case 'linux':
            throw new Error(`Unity ${unityVersion.toString()} is not supported on Linux!`);
        case 'win32':
            {
                const installPath = path.join(installDir, `Unity ${unityVersion.version}`);
                if (!fs.existsSync(installPath)) {
                    const scriptPath = path.join(__dirname, 'unity-editor-installer.ps1');
                    const exitCode = await exec.exec('pwsh', [scriptPath, unityVersion.version, installDir]);
                    if (exitCode !== 0) {
                        throw new Error(`Failed to install Unity ${unityVersion.toString()}: ${exitCode}`);
                    }
                }
                await fs.promises.access(installPath, fs.constants.R_OK);
                return installPath;
            }
        case 'darwin':
            {
                const installPath = path.join(installDir, `Unity ${unityVersion.version}`, 'Unity.app');
                if (!fs.existsSync(installPath)) {
                    const scriptPath = path.join(__dirname, 'unity-editor-installer.sh');
                    await fs.promises.chmod(scriptPath, 0o755);
                    const exitCode = await exec.exec('sh', [scriptPath, unityVersion.version, installDir]);
                    if (exitCode !== 0) {
                        throw new Error(`Failed to install Unity ${unityVersion.toString()}: ${exitCode}`);
                    }
                }
                await fs.promises.access(installPath, fs.constants.R_OK);
                return installPath;
            }
    }
}

export async function ListInstalledEditors(): Promise<string[]> {
    return (await execUnityHub(['editors', '-i'])).split('\n').filter(line => line.trim().length > 0).map(line => line.trim());
}

const archMap = {
    'ARM64': 'Apple silicon',
    'X86_64': 'Intel',
}

async function checkInstalledEditors(unityVersion: UnityVersion, failOnEmpty: boolean, installPath: string | undefined = undefined): Promise<string | undefined> {
    let editorPath = undefined;
    if (!installPath) {
        const paths: string[] = await ListInstalledEditors();
        core.debug(`Paths: ${JSON.stringify(paths, null, 2)}`);
        if (paths && paths.length > 0) {
            const pattern = /(?<version>\d+\.\d+\.\d+[abcfpx]?\d*)\s*(?:\((?<arch>Apple silicon|Intel)\))?\s*,? installed at (?<editorPath>.*)/;
            const matches = paths.map(path => path.match(pattern)).filter(match => match && match.groups);
            core.debug(`Matches: ${JSON.stringify(matches, null, 2)}`);
            if (paths.length !== matches.length) {
                throw new Error(`Failed to parse all installed Unity Editors!`);
            }
            // Prefer exact version match first
            const exactMatch = matches.find(match => match.groups.version === unityVersion.version);
            if (exactMatch) {
                editorPath = exactMatch.groups.editorPath;
            } else {
                // Fallback: semver satisfies
                const versionMatches = matches.filter(match => unityVersion.satisfies(match.groups.version));
                core.debug(`Version Matches: ${JSON.stringify(versionMatches, null, 2)}`);
                if (versionMatches.length === 0) {
                    return undefined;
                }
                for (const match of versionMatches) {
                    // If no architecture is set, or no arch in match, accept the version match
                    if (!unityVersion.architecture || !match.groups.arch) {
                        editorPath = match.groups.editorPath;
                    }
                    // If architecture is set and present in match, check for match
                    else if (archMap[unityVersion.architecture] === match.groups.arch) {
                        editorPath = match.groups.editorPath;
                    }
                    // Fallback: check if editorPath includes architecture string (case-insensitive)
                    else if (unityVersion.architecture && match.groups.editorPath.toLowerCase().includes(`-${unityVersion.architecture.toLowerCase()}`)) {
                        editorPath = match.groups.editorPath;
                    }
                }
            }
        }
    } else {
        if (process.platform == 'win32') {
            editorPath = path.join(installPath, 'Unity.exe');
        } else {
            editorPath = installPath;
        }
    }
    if (!editorPath) {
        if (failOnEmpty) {
            throw new Error(`Failed to find installed Unity Editor: ${unityVersion.toString()}`);
        }
        else {
            return undefined;
        }
    }
    if (process.platform === 'darwin') {
        editorPath = path.join(editorPath, '/Contents/MacOS/Unity');
    }
    try {
        await fs.promises.access(editorPath, fs.constants.R_OK);
    } catch (error) {
        throw new Error(`Failed to find installed Unity Editor: ${unityVersion.toString()}\n  > ${error.message}`);
    }
    core.debug(`Found installed Unity Editor: ${editorPath}`);
    return editorPath;
}

async function checkEditorModules(editorPath: string, unityVersion: UnityVersion, modules: string[]): Promise<[string[], string[]]> {
    let args = ['install-modules', '--version', unityVersion.version];
    if (unityVersion.architecture) {
        args.push('-a', unityVersion.architecture.toLowerCase());
    }
    for (const module of modules) {
        args.push('-m', module);
    }
    const output = await execUnityHub([...args, '--cm']);
    const editorRootPath = await GetEditorRootPath(editorPath);
    const modulesPath = path.join(editorRootPath, 'modules.json');
    core.debug(`Editor Modules Manifest:\n  > "${modulesPath}"`);
    const moduleMatches = output.matchAll(/Omitting module (?<module>.+) because it's already installed/g);
    if (moduleMatches) {
        const omittedModules = [...moduleMatches].map(match => match.groups.module);
        for (const module of omittedModules) {
            if (!modules.includes(module)) {
                modules.push(module);
            }
        }
    }
    const installedModules = [...modules];
    const additionalModules = [];
    const additionalModulesJson = await getModulesContent(modulesPath);
    if (additionalModulesJson.length > 0) {
        for (const module of additionalModulesJson) {
            if (module.category === "Platforms" && module.visible === true) {
                if (!installedModules.includes(module.id)) {
                    additionalModules.push(module.id);
                }
            }
        }
    }
    return [installedModules, additionalModules];
}

async function getModulesContent(modulesPath: string): Promise<any> {
    const modulesContent = await ReadFileContents(modulesPath);
    return JSON.parse(modulesContent);
}

export async function getEditorReleaseInfo(unityVersion: UnityVersion): Promise<UnityRelease> {
    // Prefer querying the releases API with the exact fully-qualified Unity version (e.g., 2022.3.10f1).
    // If we don't have a fully-qualified version, use the most specific prefix available:
    //  - "YYYY.M" when provided (e.g., 6000.1)
    //  - otherwise "YYYY"
    const fullUnityVersionPattern = /^\d{1,4}\.\d+\.\d+[abcfpx]\d+$/;
    let version: string;
    if (fullUnityVersionPattern.test(unityVersion.version)) {
        version = unityVersion.version;
    } else {
        const mm = unityVersion.version.match(/^(\d{1,4})(?:\.(\d+))?/);
        if (mm) {
            version = mm[2] ? `${mm[1]}.${mm[2]}` : mm[1];
        } else {
            version = unityVersion.version.split('.')[0];
        }
    }

    const releasesClient = new UnityReleasesClient();
    const request: GetUnityReleasesData = {
        query: {
            version: version,
            architecture: [unityVersion.architecture],
            platform: GetCurrentPlatform(),
            limit: 1,
        }
    };

    core.debug(`Get Unity Release: ${JSON.stringify(request, null, 2)}`);
    const { data, error } = await releasesClient.api.ReleaseService.getUnityReleases(request);

    if (error) {
        throw new Error(`Failed to get Unity releases: ${error}`);
    }

    if (!data || !data.results || data.results.length === 0) {
        throw new Error(`No Unity releases found for version: ${version}`);
    }
    core.debug(`Found Unity Release: ${JSON.stringify(data, null, 2)}`);
    // Filter to stable 'f' releases only unless the user explicitly asked for a pre-release
    const isExplicitPrerelease = /[abcpx]$/.test(unityVersion.version) || /[abcpx]/.test(unityVersion.version);
    const results = (data.results || [])
        .filter(r => isExplicitPrerelease ? true : /f\d+$/.test(r.version))
        // Sort descending by minor, patch, f-number where possible; fallback to semver coercion
        .sort((a, b) => {
            const parse = (v: string) => {
                const m = v.match(/(\d{1,4})\.(\d+)\.(\d+)([abcfpx])(\d+)/);
                return m ? [parseInt(m[2]), parseInt(m[3]), m[4], parseInt(m[5])] as [number, number, string, number] : [0, 0, 'f', 0] as [number, number, string, number];
            };
            const [aMinor, aPatch, aTag, aNum] = parse(a.version);
            const [bMinor, bPatch, bTag, bNum] = parse(b.version);
            // Prefer higher minor
            if (aMinor !== bMinor) return bMinor - aMinor;
            // Then higher patch
            if (aPatch !== bPatch) return bPatch - aPatch;
            // Tag order: f > p > c > b > a > x
            const order = { f: 5, p: 4, c: 3, b: 2, a: 1, x: 0 } as Record<string, number>;
            if (order[aTag] !== order[bTag]) return (order[bTag] || 0) - (order[aTag] || 0);
            return bNum - aNum;
        });

    if (results.length === 0) {
        throw new Error(`No suitable Unity releases (stable) found for version: ${version}`);
    }

    core.debug(`Found Unity Release: ${JSON.stringify({ query: version, picked: results[0] }, null, 2)}`);
    return results[0];
}

async function fallbackVersionLookup(unityVersion: UnityVersion): Promise<UnityVersion> {
    let version = unityVersion.version.split('.')[0];

    if (/^\d{1,4}\.0(\.0)?$/.test(unityVersion.version)) {
        version = unityVersion.version.split('.')[0];
    }

    const url = `https://unity.com/releases/editor/whats-new/${version}`;
    core.debug(`Fetching release page: "${url}"`);
    let response: Response;

    try {
        response = await fetch(url);
    } catch (error) {
        core.warning(`Failed to fetch changeset for Unity ${unityVersion.toString()} [network error]: ${error}`);
        return unityVersion;
    }

    if (!response.ok) {
        throw new Error(`Failed to fetch changeset [${response.status}] "${url}"`);
    }

    const data = await response.text();
    core.debug(`Release page content:\n${data}`);
    const match = data.match(/unityhub:\/\/(?<version>\d+\.\d+\.\d+[abcfpx]?\d*)\/(?<changeset>[a-zA-Z0-9]+)/);

    if (match && match.groups && match.groups.changeset) {
        return new UnityVersion(match.groups.version, match.groups.changeset, unityVersion.architecture);
    }

    core.error(`Failed to find changeset for Unity ${unityVersion.toString()}`);
    return unityVersion;
}

import { GetHubRootPath, GetEditorRootPath, ReadFileContents } from './utility';
import asar = require('@electron/asar');
import core = require('@actions/core');
import exec = require('@actions/exec');
import semver = require('semver');
import yaml = require('yaml');
import path = require('path');
import os = require('os');
import fs = require('fs');

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
    const hubVersion = await getInstalledHubVersion();
    if (!semver.valid(hubVersion)) {
        throw new Error(`Failed to get installed Unity Hub version ${hubVersion}!`);
    }
    core.info(`Unity Hub Version:\n  > ${hubVersion}`);
    const latestHubVersion = await getLatestHubVersion();
    if (!semver.valid(latestHubVersion)) {
        throw new Error(`Failed to get latest Unity Hub version ${latestHubVersion}!`);
    }
    core.debug(`Latest Unity Hub Version:\n  > ${latestHubVersion}`);
    core.debug(`Comparing versions:\n  > ${hubVersion} < ${latestHubVersion} => ${semver.compare(hubVersion, latestHubVersion)}`);
    if (semver.compare(hubVersion, latestHubVersion) < 0) {
        core.info(`Installing Latest Unity Hub Version:\n  > ${latestHubVersion}`);
        if (process.platform !== 'linux') {
            core.info(`Removing previous Unity Hub version:\n  > ${hubVersion}`);
            await removePath(hubPath);
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

async function getInstalledHubVersion(): Promise<semver.SemVer> {
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

async function getLatestHubVersion(): Promise<semver.SemVer> {
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
    `Failed to connect to the bus:`
];

async function execUnityHub(args: string[]): Promise<string> {
    if (!hubPath) {
        throw new Error('Unity Hub Path is not set!');
    }
    let output = '';
    switch (process.platform) {
        case 'win32': // "C:/Program Files/Unity Hub/Unity Hub.exe" -- --headless help
        case 'darwin': // "/Applications/Unity Hub.app/Contents/MacOS/Unity Hub" -- --headless help
            await exec.exec(`"${hubPath}"`, ['--', '--headless', ...args], {
                listeners: {
                    stdout: (data) => {
                        output += data.toString();
                    },
                    stderr: (data) => {
                        output += data.toString();
                    }
                },
                ignoreReturnCode: true
            });
            break;
        case 'linux': // unity-hub --headless help
            core.info(`[command]unity-hub --headless ${args.join(' ')}`);
            await exec.exec('unity-hub', ['--headless', ...args], {
                listeners: {
                    stdline: (data) => {
                        const line = data.toString();
                        if (line && line.trim().length > 0) {
                            if (ignoredLines.some(ignored => line.includes(ignored))) {
                                return;
                            }
                            core.info(data);
                        }
                    },
                    stdout: (data) => {
                        output += data.toString();
                    },
                    stderr: (data) => {
                        output += data.toString();
                    }
                },
                ignoreReturnCode: true,
                silent: true
            });
            break;
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

export async function Unity(version: string, changeset: string, architecture: string, modules: string[]): Promise<string> {
    if (os.arch() == 'arm64' && !isArmCompatible(version)) {
        core.warning(`Unity ${version} does not support arm64 architecture, falling back to x86_64`);
        architecture = 'x86_64';
    }
    if (!changeset) {
        const [latestVersion, latestChangeset] = await getLatestRelease(version, architecture === 'arm64');
        version = latestVersion;
        changeset = latestChangeset
    }
    if (!changeset) {
        core.debug(`Fetching changeset for Unity ${version}...`);
        changeset = await getChangeset(version);
    }
    let editorPath = await checkInstalledEditors(version, architecture, false);
    if (!editorPath) {
        try {
            await installUnity(version, changeset, architecture, modules);
        } catch (error) {
            if (retryErrorMessages.some(msg => error.message.includes(msg))) {
                await removePath(editorPath);
                await installUnity(version, changeset, architecture, modules);
            }
        }
        editorPath = await checkInstalledEditors(version, architecture);
    }
    await fs.promises.access(editorPath, fs.constants.X_OK);
    core.info(`Unity Editor Path:\n  > "${editorPath}"`);
    try {
        const changesetStr = changeset ? ` (${changeset})` : '';
        core.startGroup(`Checking installed modules for Unity ${version}${changesetStr}...`);
        const [installedModules, additionalModules] = await checkEditorModules(editorPath, version, architecture, modules);
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
        if (process.platform === 'linux') {
            const dataPath = path.join(path.dirname(editorPath), 'Data');
            const beeBackend = path.join(dataPath, 'bee_backend');
            const dotBeeBackend = path.join(dataPath, '.bee_backend');
            if (fs.existsSync(beeBackend) && !fs.existsSync(dotBeeBackend)) {
                await fs.promises.rename(beeBackend, dotBeeBackend);
                const wrapperSource = path.join(__dirname, 'linux-bee-backend-wrapper.sh');
                await fs.promises.copyFile(wrapperSource, beeBackend);
                await fs.promises.chmod(beeBackend, 0o755);
            }
        }
    } catch (error) {
        if (error.message.includes(`No modules found`)) {
            removePath(editorPath);
            await Unity(version, changeset, architecture, modules);
        }
    } finally {
        core.endGroup();
    }
    return editorPath;
}

async function getLatestRelease(version: string, isSilicon: boolean): Promise<[string, string]> {
    const releases = (await execUnityHub([`editors`, `--releases`])).split('\n');
    const semVersion = semver.coerce(version);
    const validReleases = releases
        .map(release => semver.coerce(release))
        .filter(release => release && semver.satisfies(release, `^${semVersion}`))
        .sort((a, b) => semver.compare(b, a));
    for (const release of validReleases) {
        const originalRelease = releases.find(r => r.includes(release.version));
        const match = originalRelease.match(/(?<version>\d+\.\d+\.\d+[fab]?\d*)\s*(?:\((?<arch>Apple silicon|Intel)\))?/);
        if (!(match && match.groups && match.groups.version)) { continue; }
        if ((version.includes('a') && match.groups.version.includes('a')) ||
            (version.includes('b') && match.groups.version.includes('b')) ||
            match.groups.version.includes('f')) {
            core.info(`Found Unity ${match.groups.version}`);
            return [match.groups.version, undefined];
        }
    }
    core.debug(`Searching for Unity ${version} release from online releases list...`);
    const baseUrl = `https://public-cdn.cloud.unity3d.com/hub/prod`;
    const url = isSilicon
        ? `${baseUrl}/releases-silicon.json`
        : `${baseUrl}/releases-${process.platform}.json`;
    const response = await fetch(url);
    const data = await response.text();
    return await parseReleases(version, data);
}

async function parseReleases(version: string, data: string): Promise<[string, string]> {
    const releases = JSON.parse(data);
    core.debug(`Found ${releases.official.length} official releases...`);
    releases.official.sort((a: any, b: any) => semver.compare(a.version, b.version, true));
    for (const release of releases.official) {
        const semVersion = semver.coerce(version);
        const semVerRelease = semver.coerce(release.version);
        core.debug(`Checking ${semVersion} against ${semVerRelease}`);
        if (semver.satisfies(semVerRelease, `^${semVersion}`)) {
            core.debug(`Found Unity ${release.version} release.`);
            const match = release.downloadUrl.match(/download_unity\/(?<changeset>[a-zA-Z0-9]+)\//);
            if (match && match.groups && match.groups.changeset) {
                const changeset = match.groups.changeset;
                core.debug(`Found Unity ${release.version} (${changeset})`);
                return [release.version, changeset];
            }
        }
    }
    throw new Error(`Failed to find Unity ${version} release. Please provide a valid changeset.`);
}

async function installUnity(version: string, changeset: string, architecture: string, modules: string[]): Promise<void> {
    core.startGroup(`Installing Unity ${version} (${changeset})...`);
    const args = ['install', '--version', version];
    if (changeset) {
        args.push('--changeset', changeset);
    }
    if (architecture) {
        args.push('-a', architecture);
    }
    for (const module of modules) {
        core.info(`  > with module: ${module}`);
        args.push('-m', module);
    }
    try {
        const output = await execUnityHub([...args, '--cm']);
        if (output.includes(`Error while installing an editor or a module from changeset`)) {
            throw new Error(`Failed to install Unity ${version} (${changeset})`);
        }
    } finally {
        core.endGroup();
    }
}

export async function ListInstalledEditors(): Promise<string> {
    return await execUnityHub(['editors', '-i']);
}

function isArmCompatible(version: string): boolean {
    const semVersion = semver.coerce(version);
    if (semVersion.major < 2021) { return false; }
    return semver.compare(semVersion, '2021.0.0', true) >= 0;
}

async function checkInstalledEditors(version: string, architecture: string, failOnEmpty = true): Promise<string> {
    const output = await ListInstalledEditors();
    if (!output || output.trim().length === 0) {
        if (failOnEmpty) {
            throw new Error('No Unity Editors installed!');
        }
        return undefined;
    }
    const pattern = new RegExp(/(?<version>\d+\.\d+\.\d+[fab]?\d*)\s*(?:\((?<arch>Apple silicon|Intel)\))?, installed at (?<editorPath>.*)/, 'g');
    const matches = [...output.matchAll(pattern)];
    let editorPath = undefined;
    const versionMatches = matches.filter(match => match.groups.version === version);
    if (versionMatches.length === 0) {
        if (failOnEmpty) {
            throw new Error('No Unity Editors installed!');
        }
        return undefined;
    }
    for (const match of versionMatches) {
        if (!architecture) {
            editorPath = match.groups.editorPath;
        }
        if (archMap[architecture] === match.groups.arch) {
            editorPath = match.groups.editorPath;
        }
        if (match.groups.editorPath.includes(`-${architecture}`)) {
            editorPath = match.groups.editorPath;
        }
    }
    if (!editorPath) {
        throw new Error(`Failed to find installed Unity Editor: ${version} ${architecture ?? ''}`);
    }
    if (process.platform === 'darwin') {
        editorPath = path.join(editorPath, '/Contents/MacOS/Unity');
    }
    await fs.promises.access(editorPath, fs.constants.R_OK);
    core.debug(`Found installed Unity Editor: ${editorPath}`);
    return editorPath;
}

const archMap = {
    'arm64': 'Apple silicon',
    'x86_64': 'Intel',
}

async function checkEditorModules(editorPath: string, version: string, architecture: string, modules: string[]): Promise<[string[], string[]]> {
    let args = ['install-modules', '--version', version];
    if (architecture) {
        args.push('-a', architecture);
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

async function getChangeset(version: string): Promise<string | null> {
    version = version.split(/[abf]/)[0];
    const url = `https://unity.com/releases/editor/whats-new/${version}`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch changeset [${response.status}] "${url}"`);
    }
    const data = await response.text();
    const match = data.match(/unityhub:\/\/(?<version>\d+\.\d+\.\d+[fab]?\d*)\/(?<changeset>[a-zA-Z0-9]+)/);
    if (match && match.groups && match.groups.changeset) {
        return match.groups.changeset;
    }
    core.error(`Failed to find changeset for Unity ${version}`);
    return null;
}

async function removePath(targetPath: string): Promise<void> {
    core.startGroup(`deleting ${targetPath}...`);
    try {
        await fs.promises.rm(targetPath, { recursive: true, force: true });
    } finally {
        core.endGroup();
    }
}

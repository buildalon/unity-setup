const { GetHubRootPath, GetEditorRootPath, ReadFileContents } = require('./utility');
const core = require('@actions/core');
const exec = require('@actions/exec');
const fs = require('fs').promises;
const semver = require('semver');
const path = require('path');
const os = require('os');
const asar = require('@electron/asar');
const yaml = require('yaml');

const unityHub = init();
let hubPath = unityHub.hubPath;

function init() {
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

async function Get() {
    try {
        await fs.access(hubPath, fs.constants.X_OK);
    } catch (error) {
        hubPath = await installUnityHub();
    }
    const hubVersion = await getInstalledHubVersion();
    core.info(`Unity Hub Version:\n  > ${hubVersion}`);
    const latestHubVersion = await getLatestHubVersion();
    if (semver.lt(hubVersion, latestHubVersion)) {
        core.info(`Installing Latest Unity Hub Version:\n  > ${latestHubVersion}`);
        hubPath = await installUnityHub();
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

async function installUnityHub() {
    let exitCode = undefined;
    switch (process.platform) {
        case 'win32':
            {
                const scriptPath = path.normalize(path.join(__dirname, 'install-unityhub-windows.ps1'));
                exitCode = await exec.exec('pwsh', [scriptPath]);
                if (exitCode !== 0) {
                    throw new Error(`Failed to install Unity Hub: ${exitCode}`);
                }
                await fs.access(unityHub.hubPath, fs.constants.X_OK);
                return unityHub.hubPath;
            }
        case 'darwin':
            {
                const scriptPath = path.join(__dirname, 'install-unityhub-macos.sh');
                exitCode = await exec.exec('sh', [scriptPath]);
                if (exitCode !== 0) {
                    throw new Error(`Failed to install Unity Hub: ${exitCode}`);
                }
                await fs.access(unityHub.hubPath, fs.constants.X_OK);
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
                await fs.access(hubPath, fs.constants.X_OK);
                return hubPath;
            }
    }
}

async function getInstalledHubVersion() {
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
        await fs.access(asarPath, fs.constants.R_OK);
        const fileBuffer = asar.extractFile(asarPath, 'package.json');
        const packageJson = JSON.parse(fileBuffer.toString());
        return semver.coerce(packageJson.version);
    } catch (error) {
        core.error(error);
        return undefined;
    }
}

async function getLatestHubVersion() {
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
    `This error originated either by throwing inside of an async function without a catch block, or by rejecting a promise which was not handled with .catch(). The promise rejected with the reason:`,
    `dri3 extension not supported`,
    `Failed to connect to the bus:`
];

async function execUnityHub(args) {
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
        case 'linux': // xvfb-run --auto-servernum "~/Unity Hub/UnityHub.AppImage" --headless help
            core.info(`[command]xvfb-run --auto-servernum "${hubPath}" --headless ${args.join(' ')}`);
            await exec.exec('xvfb-run', ['--auto-servernum', hubPath, '--headless', ...args], {
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
        core.warning(`Install failed, retrying...`)
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

async function Unity(version, changeset, architecture, modules) {
    if (os.arch() == 'arm64' && !isArmCompatible(version)) {
        core.info(`Unity ${version} does not support arm64 architecture, falling back to x86_64`);
        architecture = 'x86_64';
    }
    let editorPath = await checkInstalledEditors(version, architecture, false);
    if (!editorPath) {
        await installUnity(version, changeset, architecture, modules);
        editorPath = await checkInstalledEditors(version, architecture);
    }
    await fs.access(editorPath, fs.constants.R_OK);
    core.info(`Unity Editor Path:\n  > "${editorPath}"`);
    try {
        core.startGroup(`Checking installed modules for Unity ${version} (${changeset})...`);
        [installedModules, additionalModules] = await checkEditorModules(editorPath, version, architecture, modules);
    } finally {
        core.endGroup();
    }
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
    return editorPath;
}

async function installUnity(version, changeset, architecture, modules) {
    core.startGroup(`Installing Unity ${version} (${changeset})...`);
    let args = ['install', '--version', version, '--changeset', changeset];
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

async function ListInstalledEditors() {
    await execUnityHub(['editors', '-i']);
}

function isArmCompatible(version) {
    return semver.compare(version, '2021.1.0f1', true) >= 0;
}

async function checkInstalledEditors(version, architecture, failOnEmpty = true) {
    const output = await execUnityHub(['editors', '-i']);
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
    switch (process.platform) {
        case 'darwin':
            editorPath = path.join(editorPath, '/Contents/MacOS/Unity');
            break;
        default:
            break;
    }
    await fs.access(editorPath, fs.constants.R_OK);
    core.debug(`Found installed Unity Editor: ${editorPath}`);
    return editorPath;
}

const archMap = {
    'arm64': 'Apple silicon',
    'x86_64': 'Intel',
};

async function checkEditorModules(editorPath, version, architecture, modules) {
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

async function getModulesContent(modulesPath) {
    const modulesContent = await ReadFileContents(modulesPath);
    return JSON.parse(modulesContent);
}

module.exports = { Get, Unity, ListInstalledEditors }

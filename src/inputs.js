const { FindGlobPattern } = require('./utility');
const core = require('@actions/core');
const fs = require('fs').promises;
const semver = require('semver');
const path = require('path');
const os = require('os');

async function ValidateInputs() {
    const modules = [];
    const architecture = core.getInput('architecture') || getInstallationArch();
    if (architecture) {
        core.info(`architecture:\n  > ${architecture}`);
    }
    const buildTargets = getArrayInput('build-targets');
    const modulesInput = getArrayInput('modules');
    if (buildTargets.length == 0) {
        if (modulesInput.length > 0) {
            modules.push(...modulesInput);
        } else {
            modules.push(...getDefaultModules());
        }
    } else {
        modules.push(...modulesInput);
    }
    core.info(`modules:`);
    for (const module of modulesInput) {
        core.info(`  > ${module}`);
    }
    core.info(`buildTargets:`);
    const moduleMap = getPlatformTargetModuleMap();
    for (const target of buildTargets) {
        const module = moduleMap[target];
        if (module === undefined) {
            core.warning(`${target} not a valid build target!`);
            continue;
        }
        if (!modules.includes(module)) {
            modules.push(module);
        }
        core.info(`  > ${target} -> ${module}`);
    }
    if (modules.length == 0) {
        throw Error('No modules or build-targets provided!');
    }
    const versions = getUnityVersionsFromInput();
    const versionFilePath = await getVersionFilePath();
    const unityProjectPath = versionFilePath !== undefined ? path.join(versionFilePath, '..', '..') : undefined;
    if (versionFilePath) {
        core.info(`versionFilePath:\n  > "${versionFilePath}"`);
        core.info(`Unity Project Path:\n  > "${unityProjectPath}"`);
        const [unityVersion, changeset] = await getUnityVersionFromFile(versionFilePath);
        if (versions.length === 0) {
            versions.push([unityVersion, changeset]);
        }
    }
    versions.sort(([a], [b]) => semver.compare(a, b, true));
    core.info(`Unity Versions:`);
    for (const [version, changeset] of versions) {
        core.info(`  > ${version} (${changeset})`);
    }
    return [versions, architecture, modules, unityProjectPath];
}

function getArrayInput(key) {
    let input = core.getInput(key);
    if (!input) { return []; }
    core.debug(`raw input | ${key}: ${input}`);
    let array = input.split(/,?\s+/).filter(Boolean);
    core.debug(`split | ${key}:`);
    for (const item of array) {
        core.debug(`  > ${item}`);
    }
    return array;
}

function getInstallationArch() {
    switch (os.arch()) {
        case 'arm64':
            return 'arm64';
        case 'x64':
            return undefined;
        default:
            throw Error(`${os.arch()} not supported`);
    }
}

function getPlatformTargetModuleMap() {
    const osType = os.type();
    let moduleMap = undefined;
    if (osType == 'Linux') {
        moduleMap = {
            "StandaloneLinux64": "linux-il2cpp",
            "Android": "android",
            "WebGL": "webgl",
            "iOS": "ios",
        };
    } else if (osType == 'Darwin') {
        moduleMap = {
            "StandaloneOSX": "mac-il2cpp",
            "iOS": "ios",
            "Android": "android",
            "tvOS": "appletv",
            "StandaloneLinux64": "linux-il2cpp",
            "WebGL": "webgl",
            "VisionOS": "visionos"
        };
    } else if (osType == 'Windows_NT') {
        moduleMap = {
            "StandaloneWindows64": "windows-il2cpp",
            "WSAPlayer": "universal-windows-platform",
            "Android": "android",
            "iOS": "ios",
            "tvOS": "appletv",
            "StandaloneLinux64": "linux-il2cpp",
            "Lumin": "lumin",
            "WebGL": "webgl",
        };
    } else {
        throw Error(`${osType} not supported`);
    }
    return moduleMap;
}

function getDefaultModules() {
    switch (process.platform) {
        case 'linux':
            return ['linux-il2cpp', 'android', 'ios'];
        case 'darwin':
            return ['mac-il2cpp', 'android', 'ios'];
        case 'win32':
            return ['windows-il2cpp', 'android', 'universal-windows-platform'];
        default:
            throw Error(`${process.platform} not supported`);
    }
}

async function getVersionFilePath() {
    let projectVersionPath = core.getInput('version-file');
    if (projectVersionPath !== undefined && projectVersionPath.toLowerCase() === 'none') {
        return undefined;
    }
    if (!projectVersionPath) {
        projectVersionPath = await FindGlobPattern(path.join(process.env.GITHUB_WORKSPACE, '**', 'ProjectVersion.txt'));
    }
    if (projectVersionPath) {
        try {
            await fs.access(projectVersionPath, fs.constants.R_OK);
            return projectVersionPath;
        } catch (error) {
            core.debug(error);
            try {
                projectVersionPath = path.join(process.env.GITHUB_WORKSPACE, projectVersionPath);
                await fs.access(projectVersionPath, fs.constants.R_OK);
                return projectVersionPath;
            } catch (error) {
                core.error(error);
                try {
                    projectVersionPath = await FindGlobPattern(path.join(process.env.GITHUB_WORKSPACE, '**', 'ProjectVersion.txt'));
                    await fs.access(projectVersionPath, fs.constants.R_OK);
                    return projectVersionPath;
                } catch (error) {
                    // ignore
                }
            }
        }
    }
    core.warning(`Could not find ProjectVersion.txt in ${process.env.GITHUB_WORKSPACE}! UNITY_PROJECT_PATH will not be set.`);
    return undefined;
}

function getUnityVersionsFromInput() {
    const versions = [];
    const inputVersions = core.getInput('unity-version');
    if (!inputVersions || inputVersions.length == 0) {
        return versions;
    }
    const versionRegEx = new RegExp(/(?<version>(?:(?<major>\d+)\.)?(?:(?<minor>\d+)\.)?(?:(?<patch>\d+[fab]\d+)\b))\s?(?:\((?<changeset>\w+)\))?/g);
    const matches = Array.from(inputVersions.matchAll(versionRegEx));
    for (const match of matches) {
        versions.push([match.groups.version, match.groups.changeset]);
    }
    return versions;
}

async function getUnityVersionFromFile(versionFilePath) {
    const versionString = await fs.readFile(versionFilePath, 'utf8');
    core.debug(`ProjectSettings.txt:\n${versionString}`);
    const match = versionString.match(/m_EditorVersionWithRevision: (?<version>(?:(?<major>\d+)\.)?(?:(?<minor>\d+)\.)?(?:(?<patch>\d+[fab]\d+)\b))\s?(?:\((?<changeset>\w+)\))?/);
    if (!match) {
        throw Error(`No version match found!`);
    }
    if (!match.groups.version) {
        throw Error(`No version group found!`);
    }
    if (!match.groups.changeset) {
        throw Error(`No changeset group found!`);
    }
    return [match.groups.version, match.groups.changeset];
}

module.exports = { ValidateInputs };

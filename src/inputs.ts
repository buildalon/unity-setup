import { FindGlobPattern } from './utility';
import core = require('@actions/core');
import semver = require('semver');
import path = require('path');
import os = require('os');
import fs = require('fs');

export async function ValidateInputs(): Promise<[string[][], string | undefined, string[], string | undefined, string]> {
    const modules: string[] = [];
    const architecture = core.getInput('architecture') || getInstallationArch();
    if (architecture) {
        core.info(`architecture:\n  > ${architecture}`);
    }
    const buildTargets = getArrayInput('build-targets');
    core.info(`modules:`);
    const modulesInput = getArrayInput('modules') || [];
    if (buildTargets.length == 0 && modulesInput.length === 0) {
        modules.push(...getDefaultModules());
        for (const module of modules) {
            core.info(`  > ${module}`);
        }
    }
    for (const module of modulesInput) {
        if (module.toLowerCase() == 'none') {
            continue;
        }
        if (!modules.includes(module)) {
            modules.push(module);
            core.info(`  > ${module}`);
        }
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
            core.info(`  > ${target} -> ${module}`);
        }
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
        const changesetStr = changeset ? ` (${changeset})` : '';
        core.info(`  > ${version}${changesetStr}`);
    }
    let installPath = core.getInput('install-path');
    if (installPath) {
        installPath = installPath.trim();
        if (installPath.length === 0) {
            installPath = undefined;
        } else {
            core.info(`Install Path:\n  > "${installPath}"`);
        }
    }
    if (!installPath) {
        core.debug('No install path specified, using default Unity Hub install path.');
    }
    return [versions, architecture, modules, unityProjectPath, installPath];
}

function getArrayInput(key: string): string[] {
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

function getInstallationArch(): string | undefined {
    switch (os.arch()) {
        case 'arm64':
            return 'arm64';
        case 'x64':
            return undefined;
        default:
            throw Error(`${os.arch()} not supported`);
    }
}

function getPlatformTargetModuleMap(): { [key: string]: string } {
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

function getDefaultModules(): string[] {
    switch (process.platform) {
        case 'linux':
            return ['linux-il2cpp'];
        case 'darwin':
            return ['mac-il2cpp'];
        case 'win32':
            return ['windows-il2cpp'];
        default:
            throw Error(`${process.platform} not supported`);
    }
}

async function getVersionFilePath(): Promise<string | undefined> {
    let projectVersionPath = core.getInput('version-file');
    if (projectVersionPath !== undefined && projectVersionPath.toLowerCase() === 'none') {
        return undefined;
    }
    if (!projectVersionPath) {
        projectVersionPath = await FindGlobPattern(path.join(process.env.GITHUB_WORKSPACE, '**', 'ProjectVersion.txt'));
    }
    if (projectVersionPath) {
        try {
            await fs.promises.access(projectVersionPath, fs.constants.R_OK);
            return projectVersionPath;
        } catch (error) {
            core.debug(error);
            try {
                projectVersionPath = path.join(process.env.GITHUB_WORKSPACE, projectVersionPath);
                await fs.promises.access(projectVersionPath, fs.constants.R_OK);
                return projectVersionPath;
            } catch (error) {
                core.error(error);
                try {
                    projectVersionPath = await FindGlobPattern(path.join(process.env.GITHUB_WORKSPACE, '**', 'ProjectVersion.txt'));
                    await fs.promises.access(projectVersionPath, fs.constants.R_OK);
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

function getUnityVersionsFromInput(): string[][] {
    const versions = [];
    const inputVersions = core.getInput('unity-version');
    if (!inputVersions || inputVersions.length == 0) {
        return versions;
    }
    const versionRegEx = new RegExp(/(?<version>(?:(?<major>\d+)\.?)(?:(?<minor>\d+)\.?)?(?:(?<patch>\d+[fab]\d+)?\b))\s?(?:\((?<changeset>\w+)\))?/g);
    const matches = Array.from(inputVersions.matchAll(versionRegEx));
    core.debug(`Unity Versions from input:`);
    for (const match of matches) {
        const version = match.groups.version.replace(/\.$/, '');
        const changeset = match.groups.changeset;
        const changesetStr = changeset ? ` (${changeset})` : '';
        core.debug(`${version}${changesetStr}`);
        versions.push([version, changeset]);
    }
    return versions;
}

async function getUnityVersionFromFile(versionFilePath: string): Promise<[string, string]> {
    const versionString = await fs.promises.readFile(versionFilePath, 'utf8');
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

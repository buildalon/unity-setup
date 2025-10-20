import fs = require('fs');
import os = require('os');
import path = require('path');
import core = require('@actions/core');
import {
    UnityHub,
    UnityVersion,
    ResolveGlobToPath
} from '@rage-against-the-pixel/unity-cli';

export async function ValidateInputs(): Promise<{ versions: UnityVersion[], modules: string[], unityProjectPath: string | null, installPath: string }> {
    const modules: string[] = [];
    const architectureInput = core.getInput('architecture') || getInstallationArch();
    let architecture: 'X86_64' | 'ARM64' | null = null;

    switch (architectureInput) {
        case 'arm64':
        case 'ARM64':
            architecture = 'ARM64';
            break;
        default:
            architecture = 'X86_64';
            break;
    }

    if (architecture) {
        core.info(`architecture:\n  > ${architecture.toLowerCase()}`);
    }

    const buildTargets = getArrayInput('build-targets');
    core.info(`modules:`);
    const modulesInput = getArrayInput('modules');

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

    const moduleMap = UnityHub.GetPlatformTargetModuleMap();

    for (const target of buildTargets) {
        const module = moduleMap[target];

        if (module === undefined) {
            if (target.toLowerCase() !== 'none') {
                core.warning(`${target} is not a valid build target for ${os.type()}`);
            }
            continue;
        }

        if (!modules.includes(module)) {
            modules.push(module);
            core.info(`  > ${target} -> ${module}`);
        }
    }

    if (modules.length === 0) {
        core.info(`  > None`);
    }

    const versions = getUnityVersionsFromInput(architecture);
    const versionFilePath = await getVersionFilePath();
    const unityProjectPath = versionFilePath !== undefined ? path.join(versionFilePath, '..', '..') : undefined;

    if (versionFilePath) {
        core.info(`versionFilePath:\n  > "${versionFilePath}"`);
        core.info(`Unity Project Path:\n  > "${unityProjectPath}"`);
        const unityVersion = await getUnityVersionFromFile(versionFilePath, architecture);
        if (versions.length === 0) {
            versions.push(unityVersion);
        }
    }

    if (versions.length > 1) {
        versions.sort(UnityVersion.compare);
    }

    core.info(`Unity Versions:`);

    for (const unityVersion of versions) {
        core.info(`  > ${unityVersion.toString()}`);
    }

    if (versions.length === 0) {
        core.info(`  > None`);
    }

    let installPath = core.getInput('install-path');

    if (installPath) {
        installPath = path.normalize(installPath.trim());

        if (installPath.length === 0) {
            installPath = undefined;
        } else {
            core.info(`Install Path:\n  > "${installPath}"`);
        }
    }

    if (!installPath) {
        core.debug('No install path specified, using default Unity Hub install path.');
    }

    return { versions, modules, unityProjectPath, installPath };
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

function getInstallationArch(): 'ARM64' | null {
    switch (os.arch()) {
        case 'arm64':
            return 'ARM64';
        case 'x64':
            return null;
        default:
            throw Error(`${os.arch()} not supported`);
    }
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
        projectVersionPath = await ResolveGlobToPath([process.env.GITHUB_WORKSPACE, '**', 'ProjectVersion.txt']);
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
                    projectVersionPath = await ResolveGlobToPath([process.env.GITHUB_WORKSPACE, '**', 'ProjectVersion.txt']);
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

function getUnityVersionsFromInput(architecture: 'X86_64' | 'ARM64' | null): UnityVersion[] {
    const versions: UnityVersion[] = [];
    const inputVersions = core.getInput('unity-version');

    if (!inputVersions || inputVersions.length == 0) {
        return versions;
    }

    if (inputVersions.toLowerCase() === 'none') {
        core.debug('No Unity Versions Specified...')
        return versions;
    }

    // Accepts versions like 2020, 2020.x, 2020.*, 2020.3, 2020.3.0, 2020.3.x, 2020.3.*, 2020.3.0f1, 2020.3.0f1 (c7b5465681fb)
    const versionRegEx = /(?<version>\d+(?:\.(?:\d+|x|\*)){0,2}(?:[abcfpx]\d+)?)(?:\s*\((?<changeset>\w+)\))?/g;
    const matches = Array.from(inputVersions.matchAll(versionRegEx));
    core.debug(`Regex version matches from input:`);

    for (const match of matches) {
        if (!match.groups || !match.groups.version) { continue; }

        let version = match.groups.version.replace(/\.$/, '');
        version = version.replace(/(\.(x|\*))+$/, '');
        // Normalize version to semver when appropriate (e.g., 2021.3 -> 2021.3.0)
        // IMPORTANT: Preserve major-only inputs (e.g., "6000") to allow
        // major-series resolution to the latest stable (e.g., 6000.2.1f1).
        const versionParts = version.split('.');

        switch (versionParts.length) {
            case 1:
                // Do not coerce major-only to .0.0 – this would incorrectly
                // restrict fallback to minor 0 (e.g., 6000.0.x) instead of
                // the latest within the major series.
                break;
            case 2:
                version = version + '.0';
                break;
        }

        const changeset = match.groups.changeset;
        const unityVersion = new UnityVersion(version, changeset, architecture);
        core.debug(`  > ${unityVersion.toString()}`);

        try {
            versions.push(unityVersion);
        } catch (e) {
            core.error(`Invalid Unity version: ${unityVersion.toString()}\nError: ${e.message}`);
        }
    }

    if (versions.length === 0) {
        throw Error('Failed to parse Unity versions from input!');
    }

    return versions;
}

async function getUnityVersionFromFile(versionFilePath: string, architecture: 'X86_64' | 'ARM64' | null): Promise<UnityVersion> {
    const versionString = await fs.promises.readFile(versionFilePath, 'utf8');
    core.debug(`ProjectSettings.txt:\n${versionString}`);
    const match = versionString.match(/m_EditorVersionWithRevision: (?<version>(?:(?<major>\d+)\.)?(?:(?<minor>\d+)\.)?(?:(?<patch>\d+[abcfpx]\d+)\b))\s?(?:\((?<changeset>\w+)\))?/);

    if (!match) {
        throw Error(`No version match found!`);
    }

    if (!match.groups.version) {
        throw Error(`No version group found!`);
    }

    if (!match.groups.changeset) {
        throw Error(`No changeset group found!`);
    }

    return new UnityVersion(match.groups.version, match.groups.changeset, architecture);
}

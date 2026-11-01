import * as fs from 'fs';
import * as core from '@actions/core';
import * as cache from '@actions/cache';
import { ValidateInputs } from './inputs';
import {
    CheckAndroidSdkInstalled,
    UnityCli,
    UnityInstaller,
    UnityVersion,
} from '@rage-against-the-pixel/unity-cli';
import { ClassifyFailure } from '@rage-against-the-pixel/unity-cli/dist/failure-markers';

const IS_POST = !!core.getState('isPost');

async function main() {
    try {
        if (!IS_POST) {
            await setup();
        } else {
            await post();
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const marker = ClassifyFailure(message);

        if (marker) {
            // a failure a rerun can clear carries the marker retry-failed-jobs looks for
            core.notice(message, { title: marker });
        }

        core.setFailed(error.stack);
    }
}

main();

/**
 * Generates a cache key for Unity installation based on versions and modules.
 * @param versions Array of UnityVersion objects.
 * @param modules Array of module names.
 * @returns A string representing the cache key.
 */
function getInstallationCacheKey(versions: UnityVersion[], modules: string[]): InstallationCacheKeys {
    let cacheKey = `unity-setup-${process.platform}`;
    let restoreKeys: string[] = [];

    for (const version of versions) {
        cacheKey += `-${version.version}`;
        restoreKeys.push(`${cacheKey}`);
    }

    for (const module of modules) {
        cacheKey += `-${module}`;
        restoreKeys.push(`${cacheKey}`);
    }

    return {
        primaryKey: cacheKey,
        restoreKeys: restoreKeys
    };
}

/**
 * Reads the release channels to accept when resolving a partial version.
 * @returns The channel letters, f (stable) by default.
 */
function getChannels(): string[] {
    const allowed = ['f', 'p', 'b', 'a', 'x'];
    const channels = (core.getInput('channels') || 'f')
        .split(/[ ,]+/)
        .map(channel => channel.trim().toLowerCase())
        .filter(Boolean);

    for (const channel of channels) {
        if (!allowed.includes(channel)) {
            throw new Error(`Invalid channel '${channel}'. Expected one or more of: ${allowed.join(', ')}.`);
        }
    }

    return channels;
}

interface InstallationCacheKeys {
    primaryKey: string;
    restoreKeys: string[];
}

async function setup() {
    const { versions, modules, unityProjectPath, installPath } = await ValidateInputs();

    if (unityProjectPath) {
        core.info(`UNITY_PROJECT_PATH:\n  > ${unityProjectPath}`);
        core.exportVariable('UNITY_PROJECT_PATH', unityProjectPath);
        core.setOutput('unity-project-path', unityProjectPath);
    }

    const unityCli = await UnityCli.Get(core.getInput('unity-cli-version') || undefined);
    core.info(`UNITY_CLI_PATH:\n  > ${unityCli.executable}`);
    core.exportVariable('UNITY_CLI_PATH', unityCli.executable);
    core.setOutput('unity-cli-path', unityCli.executable);
    core.setOutput('unity-cli-version', unityCli.version);
    core.saveState('unity-cli-path', unityCli.executable);
    core.saveState('unity-cli-version', unityCli.version);
    const installer = new UnityInstaller(unityCli);

    if (installPath && installPath.length > 0) {
        await installer.SetInstallPath(installPath);
    }

    const cacheInstallationInput = core.getInput('cache-installation')?.toLowerCase() === 'true';
    let cacheRestored = false;

    if (cacheInstallationInput) {
        const unityInstallPath = await installer.GetInstallPath();
        const cacheKey = getInstallationCacheKey(versions, modules);
        core.saveState('cache-key', cacheKey.primaryKey);
        core.info(`unity installation cache key: ${cacheKey.primaryKey}`);
        const restoreKey = await cache.restoreCache([unityInstallPath], cacheKey.primaryKey, cacheKey.restoreKeys);
        const cacheHit = restoreKey === cacheKey.primaryKey;

        if (!cacheHit) {
            core.info('No unity installation cache found. Installation will be saved in post step.');
        }

        core.saveState('cache-hit', cacheHit);
        cacheRestored = !!restoreKey;
    }

    const channels = getChannels();

    if (cacheRestored && process.platform === 'linux') {
        // unity-cli installs the editor's system packages only when it installs the editor itself,
        // and the cache restores just the editor folder, so a fresh runner still needs them
        const linuxInstaller = installer as unknown as { installLinuxDependencies?: (version: UnityVersion) => Promise<void> };

        if (typeof linuxInstaller.installLinuxDependencies === 'function') {
            for (const unityVersion of versions) {
                await linuxInstaller.installLinuxDependencies.call(installer, await installer.resolveVersion(unityVersion, channels));
            }
        } else {
            core.warning('Unable to install the Linux editor dependencies for the restored Unity installation.');
        }
    }

    const allowSecurityAlert = core.getBooleanInput('allow-security-alert');
    const installedEditors: { version: string; path: string; }[] = [];

    for (const unityVersion of versions) {
        const unityEditor = await installer.GetEditor(unityVersion, modules, channels, {
            securityAlert: allowSecurityAlert ? 'allow' : 'enforce',
        });
        core.info(`UNITY_EDITOR_PATH:\n  > ${unityEditor.editorPath}`);
        // always sets to the latest installed editor path
        core.exportVariable('UNITY_EDITOR_PATH', unityEditor.editorPath);
        core.setOutput('unity-editor-path', unityEditor.editorPath);

        if (modules.includes('android') && unityProjectPath !== undefined) {
            await CheckAndroidSdkInstalled(unityEditor, unityProjectPath);
        }

        installedEditors.push({ version: unityVersion.version, path: unityEditor.editorPath });
    }

    if (installedEditors.length !== versions.length) {
        throw new Error(`Expected to install ${versions.length} Unity versions, but installed ${installedEditors.length}.`);
    }

    core.exportVariable('UNITY_EDITORS', JSON.stringify(installedEditors));
    core.setOutput('unity-editors', JSON.stringify(installedEditors));
    core.info('Unity Setup Complete!');
    core.saveState('isPost', true);
    process.exit(0);
}

async function post() {
    const cacheKey = core.getState('cache-key');

    if (!cacheKey) {
        core.info('No cache key found, skipping cache save.');
        return;
    }

    const cacheHit = core.getState('cache-hit') === 'true';

    if (cacheHit) {
        core.info(`Cache hit for ${cacheKey}, skipping cache save.`);
        return;
    }

    const saveCache = cacheKey && cacheKey.length > 0 && !cacheHit;

    if (saveCache) {
        core.info('Saving Unity installation cache...');
        const unityCli = new UnityCli(core.getState('unity-cli-path'), core.getState('unity-cli-version'));
        const unityInstallPath = await unityCli.GetInstallPath();

        if (!await isInstallationPathValid(unityInstallPath)) {
            core.warning(`Unity installation path "${unityInstallPath}" is invalid, skipping cache save.`);
            return;
        }

        await cache.saveCache([unityInstallPath], cacheKey);
        core.info(`Unity installation cache saved with key: ${cacheKey}`);
        process.exit(0);
    }
}

async function isInstallationPathValid(path: string): Promise<boolean> {
    if (!path || path.length === 0) {
        return false;
    }

    try {
        await fs.promises.access(path, fs.constants.R_OK);
    } catch {
        return false;
    }

    return true;
}

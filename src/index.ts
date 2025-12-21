import * as fs from 'fs';
import core = require('@actions/core');
import cache = require('@actions/cache');
import { ValidateInputs } from './inputs';
import {
    UnityHub,
    CheckAndroidSdkInstalled,
    UnityVersion,
} from '@rage-against-the-pixel/unity-cli';

const IS_POST = !!core.getState('isPost');

async function main() {
    try {
        if (!IS_POST) {
            await setup();
        } else {
            await post();
        }
    } catch (error) {
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

    let autoUpdate = core.getInput('auto-update-hub');
    const hubVersion = core.getInput('hub-version');

    if (autoUpdate === 'true' && hubVersion && hubVersion.length > 0) {
        autoUpdate = 'false';
    }

    const unityHub = new UnityHub();
    const unityHubPath = await unityHub.Install(autoUpdate === 'true', hubVersion);

    if (!unityHubPath || unityHubPath.length === 0) {
        throw new Error('Failed to install or locate Unity Hub!');
    }

    core.info(`UNITY_HUB_PATH:\n  > ${unityHubPath}`);
    core.exportVariable('UNITY_HUB_PATH', unityHubPath);
    core.setOutput('unity-hub-path', unityHubPath);

    if (installPath && installPath.length > 0) {
        await unityHub.SetInstallPath(installPath);
    }

    const cacheInstallationInput = core.getInput('cache-installation')?.toLowerCase() === 'true';

    if (cacheInstallationInput) {
        const unityInstallPath = await unityHub.GetInstallPath();
        const cacheKey = getInstallationCacheKey(versions, modules);
        core.saveState('cache-key', cacheKey.primaryKey);
        core.info(`unity installation cache key: ${cacheKey.primaryKey}`);
        const restoreKey = await cache.restoreCache([unityInstallPath], cacheKey.primaryKey, cacheKey.restoreKeys);
        const cacheHit = restoreKey === cacheKey.primaryKey;

        if (!cacheHit) {
            core.info('No unity installation cache found. Installation will be saved in post step.');
        }

        core.saveState('cache-hit', cacheHit);
    }

    const installedEditors: { version: string; path: string; }[] = [];

    for (const unityVersion of versions) {
        const unityEditor = await unityHub.GetEditor(unityVersion, modules);
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
        const unityHub = new UnityHub();
        const unityInstallPath = await unityHub.GetInstallPath();

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

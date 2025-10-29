import core = require('@actions/core');
import { ValidateInputs } from './inputs';
import {
    UnityHub,
    CheckAndroidSdkInstalled,
} from '@rage-against-the-pixel/unity-cli';

async function main() {
    try {
        const { versions, modules, unityProjectPath, installPath } = await ValidateInputs();

        if (unityProjectPath) {
            core.info(`UNITY_PROJECT_PATH:\n  > ${unityProjectPath}`);
            core.exportVariable('UNITY_PROJECT_PATH', unityProjectPath);
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

        if (installPath && installPath.length > 0) {
            await unityHub.SetInstallPath(installPath);
        }

        const installedEditors: { version: string; path: string; }[] = [];

        for (const unityVersion of versions) {
            const unityEditor = await unityHub.GetEditor(unityVersion, modules);
            core.info(`UNITY_EDITOR_PATH:\n  > ${unityEditor.editorPath}`);
            core.exportVariable('UNITY_EDITOR_PATH', unityEditor.editorPath); // always sets to the latest installed editor path

            if (modules.includes('android') && unityProjectPath !== undefined) {
                await CheckAndroidSdkInstalled(unityEditor, unityProjectPath);
            }

            installedEditors.push({ version: unityVersion.version, path: unityEditor.editorPath });
        }

        if (installedEditors.length !== versions.length) {
            throw new Error(`Expected to install ${versions.length} Unity versions, but installed ${installedEditors.length}.`);
        }

        core.exportVariable('UNITY_EDITORS', Object.fromEntries(installedEditors.map(e => [e.version, e.path])));
        core.info('Unity Setup Complete!');
        process.exit(0);
    } catch (error) {
        core.setFailed(error.stack);
    }
}

main();

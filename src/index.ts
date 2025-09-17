import { CheckAndroidSdkInstalled } from './install-android-sdk';
import { ValidateInputs } from './inputs';
import unityHub = require('./unity-hub');
import core = require('@actions/core');

const main = async () => {
    try {
        const [versions, modules, unityProjectPath, installPath] = await ValidateInputs();

        if (unityProjectPath) {
            core.exportVariable('UNITY_PROJECT_PATH', unityProjectPath);
        }

        const unityHubPath = await unityHub.Get();
        core.exportVariable('UNITY_HUB_PATH', unityHubPath);

        if (installPath && installPath.length > 0) {
            await unityHub.SetInstallPath(installPath);
        }

        const installedEditors: { version: string; path: string }[] = [];

        for (const unityVersion of versions) {
            const unityEditorPath = await unityHub.UnityEditor(unityVersion, modules);
            core.exportVariable('UNITY_EDITOR_PATH', unityEditorPath); // always sets to the latest installed editor path

            if (modules.includes('android') && unityProjectPath !== undefined) {
                await CheckAndroidSdkInstalled(unityEditorPath, unityProjectPath);
            }

            core.info(`Installed Unity Editor: ${unityVersion.toString()} at ${unityEditorPath}`);
            installedEditors.push({ version: unityVersion.version, path: unityEditorPath });
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
};

main();

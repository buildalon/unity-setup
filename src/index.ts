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
        const editors = [];
        for (const unityVersion of versions) {
            const unityEditorPath = await unityHub.UnityEditor(unityVersion, modules);
            core.exportVariable('UNITY_EDITOR_PATH', unityEditorPath); // always sets the last installed editor path
            if (modules.includes('android') && unityProjectPath !== undefined) {
                await CheckAndroidSdkInstalled(unityEditorPath, unityProjectPath);
            }
            core.info(`Installed Unity Editor: ${unityVersion.toString()} at ${unityEditorPath}`);
            editors.push([unityVersion.version, unityEditorPath]);
        }
        if (editors.length !== versions.length) {
            throw new Error(`Expected to install ${versions.length} Unity versions, but installed ${editors.length}.`);
        }
        core.exportVariable('UNITY_EDITORS', JSON.stringify(Object.fromEntries(editors)));
        core.info('Unity Setup Complete!');
        process.exit(0);
    } catch (error) {
        core.setFailed(error.stack);
    }
}

main();

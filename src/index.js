const { CheckAndroidSdkInstalled } = require('./install-android-sdk');
const { ValidateInputs } = require('./inputs');
const unityHub = require('./unity-hub');
const core = require('@actions/core');

const main = async () => {
    try {
        const [versions, architecture, modules, unityProjectPath] = await ValidateInputs();
        if (unityProjectPath) {
            core.exportVariable('UNITY_PROJECT_PATH', unityProjectPath);
        }
        const unityHubPath = await unityHub.Get();
        core.exportVariable('UNITY_HUB_PATH', unityHubPath);
        const editors = [];
        for (const [version, changeset] of versions) {
            const unityEditorPath = await unityHub.Unity(version, changeset, architecture, modules);
            // for now just export the highest installed version
            core.exportVariable('UNITY_EDITOR_PATH', unityEditorPath);
            if (modules.includes('android') && unityProjectPath != undefined) {
                await CheckAndroidSdkInstalled(unityEditorPath, unityProjectPath);
            }
            editors.push([version, unityEditorPath]);
        }
        const installedEditors = editors.map(([version, path]) => `\"${version}\":\"${path}\"`).join(',');
        core.exportVariable('UNITY_EDITORS', `[${installedEditors}]`);
        await unityHub.ListInstalledEditors();
        core.info('Unity Setup Complete!');
        process.exit(0);
    } catch (error) {
        core.setFailed(error);
    }
}

main();

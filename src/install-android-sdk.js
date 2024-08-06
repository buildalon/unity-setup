const { GetEditorRootPath, ReadFileContents, GetGlob } = require('./utility');
const core = require('@actions/core');
const exec = require('@actions/exec');
const glob = require('@actions/glob');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

async function CheckAndroidSdkInstalled(editorPath, projectPath) {
    core.startGroup('Validating Android Target SDK Installed...');
    let sdkPath = undefined;
    try {
        await createRepositoryCfg();
        const rootEditorPath = await GetEditorRootPath(editorPath);
        const projectSettingsPath = path.join(projectPath, 'ProjectSettings/ProjectSettings.asset');
        const projectSettingsContent = await ReadFileContents(projectSettingsPath);
        const androidTargetSdk = projectSettingsContent.match(/(?<=AndroidTargetSdkVersion: )\d+/);
        if (androidTargetSdk === undefined || androidTargetSdk === 0) { return; }
        sdkPath = await getAndroidSdkPath(rootEditorPath, androidTargetSdk);
        if (sdkPath) {
            core.info(`Target Android SDK Installed in:\n  > "${sdkPath}"`);
            return;
        }
        core.info(`Installing Android Target SDK:\n  > android-${androidTargetSdk}`);
        const sdkManagerPath = await getSdkManager(rootEditorPath);
        const javaSdk = await getJDKPath(rootEditorPath);
        await execSdkManager(sdkManagerPath, javaSdk, ['--licenses']);
        await execSdkManager(sdkManagerPath, javaSdk, ['--update']);
        await execSdkManager(sdkManagerPath, javaSdk, ['platform-tools', `platforms;android-${androidTargetSdk}`]);
        sdkPath = await getAndroidSdkPath(rootEditorPath, androidTargetSdk);
        core.info(`Target Android SDK Installed in:\n  > "${sdkPath}"`);
    } finally {
        core.endGroup();
    }
}

async function createRepositoryCfg() {
    const androidPath = path.join(os.homedir(), '.android');
    await fs.mkdir(androidPath, { recursive: true });
    const fileHandle = await fs.open(path.join(androidPath, 'repositories.cfg'), 'w');
    try {
        // Empty file
    } finally {
        await fileHandle.close();
    }
}

async function getJDKPath(rootEditorPath) {
    try {
        const jdkPath = await GetGlob(path.join(rootEditorPath, '**', 'AndroidPlayer', 'OpenJDK'));
        if (!jdkPath) {
            throw new Error(`Failed to resolve OpenJDK in ${globPath}\n  > ${globPaths}`);
        }
        await fs.access(jdkPath, fs.constants.R_OK);
        core.info(`jdkPath:\n  > "${jdkPath}"`);
        return jdkPath;
    } catch (error) {
        throw error;
    }
}

async function getSdkManager(rootEditorPath) {
    let globPath;
    switch (process.platform) {
        case 'darwin':
        case 'linux':
            globPath = path.join(rootEditorPath, '**', 'AndroidPlayer', '**', 'sdkmanager');
            break;
        case 'win32':
            globPath = path.join(rootEditorPath, '**', 'AndroidPlayer', '**', 'sdkmanager.bat');
            break;
        default:
            throw new Error(`Unsupported platform: ${process.platform}`);
    }
    const sdkmanagerPath = await GetGlob(globPath);
    if (!sdkmanagerPath) {
        throw new Error(`Failed to resolve sdkmanager in ${globPath}\n  > ${globPaths}`);
    }
    await fs.access(sdkmanagerPath, fs.constants.R_OK);
    core.info(`sdkmanagerPath:\n  > "${sdkmanagerPath}"`);
    return sdkmanagerPath;
}

async function getAndroidSdkPath(rootEditorPath, androidTargetSdk) {
    core.debug(`attempting to validate Android SDK Path...\n  > editorPath: ${rootEditorPath}\n  > androidTargetSdk: ${androidTargetSdk}`);
    const sdkPath = await GetGlob(path.join(rootEditorPath, '**', 'AndroidPlayer', '**', `android-${androidTargetSdk}`));
    if (!sdkPath) {
        throw new Error(`Failed to resolve Android SDK`);
    }
    await fs.access(sdkPath, fs.constants.R_OK);
    core.info(`sdkPath:\n  > "${sdkPath}"`);
    return sdkPath;
}

async function execSdkManager(sdkManagerPath, javaSdk, args) {
    const acceptBuffer = Buffer.from(Array(10).fill('y').join(os.EOL), 'utf8');
    core.info(`[command] "${sdkManagerPath}" ${args.join(' ')}`);
    let output = '';
    try {
        await exec.exec(`"${sdkManagerPath}"`, args, {
            env: {
                ...process.env,
                JAVA_HOME: process.platform === 'win32' ? `"${javaSdk}"` : javaSdk,
            },
            input: acceptBuffer,
            silent: !core.isDebug(),
            listeners: {
                stdout: (data) => {
                    output += data.toString();
                },
                stderr: (data) => {
                    output += data.toString();
                }
            }
        });
    } catch (error) {
        core.info(output);
        throw error;
    }
}

module.exports = { CheckAndroidSdkInstalled };

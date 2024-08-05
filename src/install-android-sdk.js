const { GetEditorRootPath, ReadFileContents } = require('./utility');
const core = require('@actions/core');
const exec = require('@actions/exec');
const glob = require('@actions/glob');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

async function CheckAndroidSdkInstalled(editorPath, projectPath) {
    core.startGroup('Validating Android Target SDK Installed...');
    try {
        const projectSettingsPath = path.join(projectPath, 'ProjectSettings/ProjectSettings.asset');
        const projectSettingsContent = await ReadFileContents(projectSettingsPath);
        const androidTargetSdk = projectSettingsContent.match(/(?<=AndroidTargetSdkVersion: )\d+/);
        if (androidTargetSdk === undefined || androidTargetSdk === 0) { return; }
        core.info(`Android Target SDK:\n  > android-${androidTargetSdk}`);
        await createRepositoryCfg();
        const sdkManagerPath = await getSdkManager(editorPath);
        const javaSdk = await getJDKPath(editorPath);
        await execSdkManager(sdkManagerPath, javaSdk, ['--licenses']);
        await execSdkManager(sdkManagerPath, javaSdk, ['--update']);
        await execSdkManager(sdkManagerPath, javaSdk, ['platform-tools', `platforms;android-${androidTargetSdk}`]);
        await validateSdkPath(editorPath, androidTargetSdk);
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

async function getJDKPath(editorPath) {
    core.debug(`editorPath: ${editorPath}`);
    const rootEditorPath = await GetEditorRootPath(editorPath);
    core.debug(`rootEditorPath: ${rootEditorPath}`);
    let globPath = path.join(rootEditorPath, '**', 'AndroidPlayer', 'OpenJDK');
    try {
        core.debug(`globPath: ${globPath}`);
        globPath = path.normalize(globPath);
        core.debug(`normalized globPath: ${globPath}`);
        const globber = await glob.create(globPath);
        const globPaths = await globber.glob();
        core.debug(`globPaths: ${globPaths}`);
        const jdkPath = globPaths[0];
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

async function getSdkManager(editorPath) {
    core.debug(`editorPath: ${editorPath}`);
    const rootEditorPath = await GetEditorRootPath(editorPath);
    core.debug(`rootEditorPath: ${rootEditorPath}`);
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
    try {
        core.debug(`globPath: ${globPath}`);
        globPath = path.normalize(globPath);
        core.debug(`normalized globPath: ${globPath}`);
        const globber = await glob.create(globPath);
        const globPaths = await globber.glob();
        core.debug(`globPaths: ${globPaths}`);
        const sdkmanagerPath = globPaths[0];
        if (!sdkmanagerPath) {
            throw new Error(`Failed to resolve sdkmanager in ${globPath}\n  > ${globPaths}`);
        }
        await fs.access(sdkmanagerPath, fs.constants.R_OK);
        core.info(`sdkmanagerPath:\n  > "${sdkmanagerPath}"`);
        return sdkmanagerPath;
    } catch (error) {
        throw error;
    }
}

async function validateSdkPath(editorPath, androidTargetSdk) {
    core.debug(`attempting to validate Android SDK Path...\n  > editorPath: ${editorPath}\n  > androidTargetSdk: ${androidTargetSdk}`);
    const rootEditorPath = await GetEditorRootPath(editorPath);
    core.debug(`rootEditorPath: ${rootEditorPath}`);
    const sdkPath = path.join(rootEditorPath, '**', 'AndroidPlayer', '**', `android-${androidTargetSdk}`);
    core.debug(`sdkPath: ${sdkPath}`);
    const globber = await glob.create(sdkPath);
    const globPaths = await globber.glob();
    core.debug(`globPaths: ${globPaths}`);
    if (globPaths.length === 0) {
        throw new Error(`Failed to install Android SDK: ${sdkPath}`);
    }
    core.info(`Target Android SDK Installed in:\n  > "${globPaths[0]}"`);
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

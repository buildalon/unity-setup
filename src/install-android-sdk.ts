import { GetEditorRootPath, ReadFileContents, FindGlobPattern } from './utility';
import core = require('@actions/core');
import exec = require('@actions/exec');
import path = require('path');
import os = require('os');
import fs = require('fs');

async function CheckAndroidSdkInstalled(editorPath: string, projectPath: string): Promise<void> {
    let sdkPath = undefined;
    await createRepositoryCfg();
    const rootEditorPath = await GetEditorRootPath(editorPath);
    const projectSettingsPath = path.join(projectPath, 'ProjectSettings/ProjectSettings.asset');
    const projectSettingsContent = await ReadFileContents(projectSettingsPath);
    const matchResult = projectSettingsContent.match(/(?<=AndroidTargetSdkVersion: )\d+/);
    const androidTargetSdk = matchResult ? parseInt(matchResult[0]) : 0;
    core.debug(`AndroidTargetSdkVersion:\n  > ${androidTargetSdk}`);
    if (androidTargetSdk === undefined || androidTargetSdk === 0) { return; }
    core.startGroup('Validating Android Target SDK Installed...');
    try {
        sdkPath = await getAndroidSdkPath(rootEditorPath, androidTargetSdk);
        if (sdkPath) {
            core.info(`Target Android SDK android-${androidTargetSdk} Installed in:\n  > "${sdkPath}"`);
            return;
        }
        core.info(`Installing Android Target SDK:\n  > android-${androidTargetSdk}`);
        const sdkManagerPath = await getSdkManager(rootEditorPath);
        const javaSdk = await getJDKPath(rootEditorPath);
        await execSdkManager(sdkManagerPath, javaSdk, ['--licenses']);
        await execSdkManager(sdkManagerPath, javaSdk, ['--update']);
        await execSdkManager(sdkManagerPath, javaSdk, ['platform-tools', `platforms;android-${androidTargetSdk}`]);
        sdkPath = await getAndroidSdkPath(rootEditorPath, androidTargetSdk);
        if (!sdkPath) {
            throw new Error(`Failed to install android-${androidTargetSdk} in ${rootEditorPath}`);
        }
        core.info(`Target Android SDK Installed in:\n  > "${sdkPath}"`);
    } finally {
        core.endGroup();
    }
}

async function createRepositoryCfg(): Promise<void> {
    const androidPath = path.join(os.homedir(), '.android');
    await fs.promises.mkdir(androidPath, { recursive: true });
    const fileHandle = await fs.promises.open(path.join(androidPath, 'repositories.cfg'), 'w');
    await fileHandle.close();
}

async function getJDKPath(rootEditorPath: string): Promise<string> {
    const jdkPath = await FindGlobPattern(path.join(rootEditorPath, '**', 'AndroidPlayer', 'OpenJDK'));
    if (!jdkPath) {
        throw new Error(`Failed to resolve OpenJDK in ${rootEditorPath}`);
    }
    await fs.promises.access(jdkPath, fs.constants.R_OK);
    core.debug(`jdkPath:\n  > "${jdkPath}"`);
    return jdkPath;
}

async function getSdkManager(rootEditorPath: string): Promise<string> {
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
    const sdkmanagerPath = await FindGlobPattern(globPath);
    if (!sdkmanagerPath) {
        throw new Error(`Failed to resolve sdkmanager in ${globPath}`);
    }
    await fs.promises.access(sdkmanagerPath, fs.constants.R_OK);
    core.debug(`sdkmanagerPath:\n  > "${sdkmanagerPath}"`);
    return sdkmanagerPath;
}

async function getAndroidSdkPath(rootEditorPath: string, androidTargetSdk: number): Promise<string | undefined> {
    core.debug(`Attempting to locate Android SDK Path...\n  > editorPath: ${rootEditorPath}\n  > androidTargetSdk: ${androidTargetSdk}`);
    const sdkPath = await FindGlobPattern(path.join(rootEditorPath, '**', 'AndroidPlayer', '**', `android-${androidTargetSdk}`));
    try {
        await fs.promises.access(sdkPath, fs.constants.R_OK);
    } catch (error) {
        core.debug(`android-${androidTargetSdk} not installed`);
        return undefined;
    }
    core.debug(`sdkPath:\n  > "${sdkPath}"`);
    return sdkPath;
}

async function execSdkManager(sdkManagerPath: string, javaSdk: string, args: string[]): Promise<void> {
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

export { CheckAndroidSdkInstalled }

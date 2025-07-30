import core = require('@actions/core');
import glob = require('@actions/glob');
import path = require('path');
import fs = require('fs');

export async function GetHubRootPath(hubPath: string): Promise<string> {
    core.debug(`searching for hub root path: ${hubPath}`);
    let hubRootPath = hubPath;
    switch (process.platform) {
        case 'darwin':
            hubRootPath = path.join(hubPath, '../../../');
            break;
        case 'win32':
            hubRootPath = path.join(hubPath, '../');
            break
        case 'linux':
            hubRootPath = path.join(hubPath, '../');
            break;
    }
    return hubRootPath;
}

export async function GetEditorRootPath(editorPath: string): Promise<string> {
    core.debug(`searching for editor root path: ${editorPath}`);
    let editorRootPath = editorPath;
    switch (process.platform) {
        case 'darwin':
            editorRootPath = path.join(editorPath, '../../../../');
            break;
        case 'linux':
            editorRootPath = path.join(editorPath, '../../');
            break;
        case 'win32':
            editorRootPath = path.join(editorPath, '../../');
            break
    }
    await fs.promises.access(editorRootPath, fs.constants.R_OK);
    core.debug(`found editor root path: ${editorRootPath}`);
    return editorRootPath;
}

export async function ReadFileContents(filePath: string): Promise<string> {
    const fileHandle = await fs.promises.open(filePath, 'r');
    try {
        const projectSettingsContent = await fileHandle.readFile('utf8');
        return projectSettingsContent;
    } finally {
        await fileHandle.close();
    }
}

export async function FindGlobPattern(pattern: string): Promise<string | undefined> {
    core.debug(`searching for: ${pattern}...`);
    const globber = await glob.create(pattern);
    for await (const file of globber.globGenerator()) {
        core.debug(`found glob: ${file}`);
        return file;
    }
}

export async function RemovePath(targetPath: string | undefined): Promise<void> {
    if (targetPath && targetPath.length > 0) {
        core.startGroup(`deleting ${targetPath}...`);
        try {
            await fs.promises.rm(targetPath, { recursive: true, force: true });
        } finally {
            core.endGroup();
        }
    }
}

export function GetCurrentPlatform(): Array<('MAC_OS' | 'LINUX' | 'WINDOWS')> {
    switch (process.platform) {
        case 'darwin':
            return ['MAC_OS'];
        case 'linux':
            return ['LINUX'];
        case 'win32':
            return ['WINDOWS'];
        default:
            throw new Error(`Unsupported platform: ${process.platform}`);
    }
}
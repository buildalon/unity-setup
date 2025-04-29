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

const core = require('@actions/core');
const fs = require('fs').promises;
const path = require('path');

async function GetEditorRootPath(editorPath) {
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
    await fs.access(editorRootPath, fs.constants.R_OK);
    core.debug(`found editor root path: ${editorRootPath}`);
    return editorRootPath;
}

async function ReadFileContents(filePath) {
    const fd = await fs.open(filePath, 'r');
    try {
        const projectSettingsContent = await fd.readFile('utf8');
        return projectSettingsContent;
    } finally {
        await fd.close();
    }
}

module.exports = { GetEditorRootPath, ReadFileContents };

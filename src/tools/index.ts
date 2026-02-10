import { getMcpTools } from '../utils/mcp.js';
import { codeOutline } from './code-outline.js';
import { copyFile } from './copy-file.js';
import { createFolder } from './create-folder.js';
import { deleteFile } from './delete-file.js';
import { editFile } from './edit-file.js';
import { fetchUrl } from './fetch.js';
import { fileInfo } from './file-info.js';
import { findFiles } from './find-files.js';
import { killProcess } from './kill-process.js';
import { listDirectory } from './list-directory.js';
import { memory } from './memory.js';
import { readFile } from './read-file.js';
import { readProcessLogs } from './read-process-logs.js';
import { renameFile } from './rename-file.js';
import { runCommand } from './run-command.js';
import { getSearchTool } from './search.js';
import { searchInFiles } from './search-in-files.js';
import { semanticSearch } from './semantic-search.js';
import { startProcess } from './start-process.js';
import { weather } from './weather.js';
import { writeFile } from './write-file.js';

let cachedMcpTools: Record<string, unknown> | null = null;

export async function loadMcpTools(): Promise<Record<string, unknown>> {
  if (!cachedMcpTools) {
    cachedMcpTools = await getMcpTools();
  }
  return cachedMcpTools;
}

export function clearMcpCache(): void {
  cachedMcpTools = null;
}

export function getTools(mcpTools?: Record<string, unknown>) {
  const search: Record<string, unknown> = getSearchTool();
  return {
    weather,
    fetchUrl,
    readFile,
    writeFile,
    editFile,
    createFolder,
    copyFile,
    renameFile,
    deleteFile,
    listDirectory,
    findFiles,
    searchInFiles,
    codeOutline,
    semanticSearch,
    fileInfo,
    runCommand,
    startProcess,
    readProcessLogs,
    killProcess,
    memory,
    ...search,
    ...(mcpTools || {}),
  };
}

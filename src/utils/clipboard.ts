import { execSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export function getClipboardImage(): Buffer | null {
  const platform = os.platform();
  const tempFile = path.join(os.tmpdir(), `ai-cli-clipboard-${Date.now()}.png`);

  try {
    if (platform === 'darwin') {
      const script = `
use framework "AppKit"
set pb to current application's NSPasteboard's generalPasteboard()
set imgData to pb's dataForType:(current application's NSPasteboardTypePNG)
if imgData is missing value then return "none"
set filePath to POSIX file "${tempFile}"
imgData's writeToFile:filePath atomically:true
return "ok"
`;
      const result = spawnSync('osascript', ['-l', 'AppleScript'], {
        input: script,
        encoding: 'utf-8',
      });
      if (result.stdout?.trim() !== 'ok') return null;
    } else if (platform === 'linux') {
      try {
        execSync(
          `xclip -selection clipboard -t image/png -o > "${tempFile}" 2>/dev/null`,
          { shell: '/bin/sh' },
        );
      } catch {
        // xclip not available, try wayland
        try {
          execSync(`wl-paste --type image/png > "${tempFile}" 2>/dev/null`, {
            shell: '/bin/sh',
          });
        } catch {
          // Neither X11 nor Wayland clipboard available
          return null;
        }
      }
    } else if (platform === 'win32') {
      const psScript = `
Add-Type -AssemblyName System.Windows.Forms
$img = [System.Windows.Forms.Clipboard]::GetImage()
if ($img -ne $null) { $img.Save("${tempFile.replace(/\\/g, '\\\\')}") }
`;
      execSync(`powershell -command "${psScript}"`, { encoding: 'utf-8' });
    } else {
      return null;
    }

    if (fs.existsSync(tempFile) && fs.statSync(tempFile).size > 0) {
      const buffer = fs.readFileSync(tempFile);
      fs.unlinkSync(tempFile);
      return buffer;
    }
  } catch {
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
  }

  return null;
}

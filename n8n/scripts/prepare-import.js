// Copies the versioned workflows to a temp folder, filling in values from the environment, for `n8n import:workflow`.
// Runs inside the n8n container: node /repo/scripts/prepare-import.js
const fs = require('fs');
const path = require('path');

const SOURCE = '/repo/workflows';
const TARGET = '/tmp/workflows-to-import';
// Optional: without it the Drive sync does nothing and only the upload API receives invoices
const driveFolderId = process.env.DRIVE_FOLDER_ID || '__DRIVE_FOLDER_ID__';
if (driveFolderId === '__DRIVE_FOLDER_ID__') console.warn('DRIVE_FOLDER_ID is not set in .env: the Drive sync is off');

fs.rmSync(TARGET, { recursive: true, force: true });
fs.mkdirSync(TARGET, { recursive: true });

for (const file of fs.readdirSync(SOURCE).filter(f => f.endsWith('.json'))) {
  const content = fs.readFileSync(path.join(SOURCE, file), 'utf8').replaceAll('__DRIVE_FOLDER_ID__', driveFolderId);
  fs.writeFileSync(path.join(TARGET, file), content, { mode: 0o600 });
  console.log(`prepared ${file}`);
}

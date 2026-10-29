// Removes instance-specific data from exported workflows so they can be committed.
// Runs inside the n8n container: node /repo/scripts/clean-export.js
const fs = require('fs');
const path = require('path');

const DIR = '/repo/workflows';
// Filled in at import (prepare-import.js) from DRIVE_FOLDER_ID
const DRIVE_FOLDER = [/const FOLDER_ID = '[^']*';/, "const FOLDER_ID = '__DRIVE_FOLDER_ID__';"];
// Fields that describe this instance (owner, versions, timestamps), not the workflow itself
const DROP = ['shared', 'versionMetadata', 'activeVersionId', 'versionCounter', 'triggerCount',
  'sourceWorkflowId', 'createdAt', 'updatedAt', 'versionId', 'staticData', 'pinData', 'isArchived'];

for (const file of fs.readdirSync(DIR).filter(f => f.endsWith('.json'))) {
  const full = path.join(DIR, file);
  let workflow = JSON.parse(fs.readFileSync(full, 'utf8'));
  if (Array.isArray(workflow)) workflow = workflow[0];

  for (const field of DROP) delete workflow[field];
  if (workflow.meta) delete workflow.meta.instanceId;
  workflow.active = false;

  for (const node of workflow.nodes) {
    if (node.type === 'n8n-nodes-base.code' && DRIVE_FOLDER[0].test(node.parameters.jsCode || '')) {
      node.parameters.jsCode = node.parameters.jsCode.replace(...DRIVE_FOLDER);
    }
  }

  fs.writeFileSync(full, JSON.stringify(workflow, null, 2) + '\n');
  console.log(`cleaned ${file}`);
}

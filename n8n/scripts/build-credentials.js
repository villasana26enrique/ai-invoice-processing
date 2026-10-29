// Builds the n8n credentials file from environment variables, for `n8n import:credentials`.
// The ids match the ones referenced by the workflows, so nodes are linked without manual selection.
// Runs inside the n8n container: node /repo/scripts/build-credentials.js
const fs = require('fs');

const env = process.env;
const OUTPUT = '/tmp/credentials-to-import.json';

// The service account key file is read on the host by setup-n8n.sh and passed as JSON text
function serviceAccount() {
  const key = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  if (key.type !== 'service_account') throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY_FILE is not a service account key');
  return key;
}

const credentials = [
  {
    id: 'pI3nV7cA2pQ8xL5k',
    name: 'Postgres invoice_app',
    type: 'postgres',
    // invoice_app, not the owner: it can only change data through the database functions
    required: ['POSTGRES_DB', 'INVOICE_APP_PASSWORD'],
    data: () => ({ host: 'postgres', port: 5432, database: env.POSTGRES_DB, user: 'invoice_app',
      password: env.INVOICE_APP_PASSWORD }),
  },
  {
    id: 'dI6vR4sA9nK2hY7c',
    name: 'Google Drive service account',
    type: 'googleApi',
    required: ['GOOGLE_SERVICE_ACCOUNT_JSON'],
    data: () => ({
      email: serviceAccount().client_email,
      privateKey: serviceAccount().private_key,
      // Used from HTTP Request nodes, read-only
      httpNode: true,
      scopes: 'https://www.googleapis.com/auth/drive.readonly',
    }),
  },
  {
    id: 'gI8mK3pQ5wE1rT4z',
    name: 'Google Gemini(PaLM) Api account',
    type: 'googlePalmApi',
    required: ['GEMINI_API_KEY'],
    data: () => ({ host: 'https://generativelanguage.googleapis.com', apiKey: env.GEMINI_API_KEY }),
  },
  {
    id: 'uP9aK2eY6uR4tW1v',
    name: 'Upload API key',
    type: 'httpHeaderAuth',
    required: ['UPLOAD_API_KEY'],
    data: () => ({ name: 'X-API-Key', value: env.UPLOAD_API_KEY }),
  },
];

const ready = [];
for (const credential of credentials) {
  const missing = credential.required.filter(name => !env[name]);
  if (missing.length) {
    console.warn(`skipped "${credential.name}": missing ${missing.join(', ')} in .env`);
    continue;
  }
  ready.push({ id: credential.id, name: credential.name, type: credential.type, data: credential.data() });
  console.log(`prepared "${credential.name}"`);
}

fs.writeFileSync(OUTPUT, JSON.stringify(ready), { mode: 0o600 });

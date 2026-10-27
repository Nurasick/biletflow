import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Transpile a TypeScript module and return an importable data: URL, with
// import specifiers optionally rewritten (as the existing tests do).
export async function moduleUrl(path, replacements = {}) {
  let source = await readFile(new URL(path, import.meta.url), 'utf8');
  for (const [from, to] of Object.entries(replacements)) source = source.replaceAll(from, to);
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  });
  return `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
}

// A scripted stand-in for src/shared/api/auth.ts. Adapters import `api` and
// `ApiError` from it; tests queue responses and read back the calls made.
// State lives on globalThis so every importer shares it.
const fakeAuthSource = `
  export class ApiError extends Error {
    constructor(message, status) { super(message); this.name = 'ApiError'; this.status = status; this.fieldErrors = {}; }
  }
  const send = async (method, path, body) => {
    // Read per call: tests replace the script after this module is imported.
    const state = globalThis.__fakeApi;
    state.calls.push({ method, path, body });
    if (!state.responses.length) throw new Error('Unexpected request ' + method + ' ' + path);
    const [status, data] = state.responses.shift();
    if (status >= 400) throw new ApiError(data?.detail ?? 'error', status);
    return data;
  };
  export const api = {
    get: (p) => send('GET', p), post: (p, b) => send('POST', p, b), put: (p, b) => send('PUT', p, b),
    patch: (p, b) => send('PATCH', p, b), delete: (p) => send('DELETE', p),
    json: (method, body) => ({ method, body: JSON.stringify(body) }),
  };
  export const rawRequest = (p, init) => send(init?.method ?? 'GET', p, init?.body && JSON.parse(init.body));
  export const optionalAuthRequest = rawRequest;
`;
export const fakeAuthUrl = `data:text/javascript;base64,${Buffer.from(fakeAuthSource).toString('base64')}`;

export function scriptApi(responses) {
  globalThis.__fakeApi = { calls: [], responses: [...responses] };
  return globalThis.__fakeApi;
}

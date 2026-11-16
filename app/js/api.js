import { apiUrl } from './config.js';

const TOKEN_KEY = 'ctrl.token';
const TIMEOUT_MS = 30000;

export class ApiError extends Error {
  constructor(code, message, extra) { super(message); this.code = code; this.extra = extra; }
}

export const session = {
  get token() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } },
  set token(v) { try { v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY); } catch { /* storage non disponibile */ } }
};

let onAuthLost = () => {};
export function setAuthLostHandler(fn) { onAuthLost = fn; }

/**
 * Chiamata all'API. Corpo text/plain per evitare il preflight CORS (Apps Script non lo gestisce).
 */
export async function api(action, payload = {}) {
  const url = apiUrl();
  if (!url) throw new ApiError('NOT_CONFIGURED', 'Indirizzo dell\'API non configurato');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, payload, token: session.token }),
      redirect: 'follow',
      signal: ctrl.signal
    });
  } catch (e) {
    throw new ApiError('NETWORK', e.name === 'AbortError'
      ? 'Il server non risponde. Controlla la connessione e riprova.'
      : 'Connessione assente. Controlla la rete e riprova.');
  } finally {
    clearTimeout(timer);
  }
  let body;
  try { body = await res.json(); } catch { throw new ApiError('SERVER', 'Risposta non valida dal server'); }
  if (!body.ok) {
    const err = new ApiError(body.error?.code || 'SERVER', body.error?.message || 'Errore', body.error);
    if (err.code === 'AUTH_REQUIRED') { session.token = ''; onAuthLost(err); }
    throw err;
  }
  return body.data;
}

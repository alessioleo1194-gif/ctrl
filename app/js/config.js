/**
 * Indirizzi dell'API (Apps Script).
 * - Produzione: il dominio principale del sito Netlify.
 * - Test: anteprime Netlify (deploy-preview-*, rami) e sviluppo locale.
 * Gli URL si compilano dopo aver pubblicato i due progetti Apps Script (vedi docs/INSTALLAZIONE.md).
 */
export const API = {
  prod: '',
  test: ''
};

/** Domini considerati produzione (il sito Netlify principale). */
export const PROD_HOSTS = [];

export function environment(host = location.hostname) {
  if (PROD_HOSTS.includes(host)) return 'prod';
  return 'test';
}

export function apiUrl() {
  if (typeof window !== 'undefined' && window.__CTRL_API__) return window.__CTRL_API__; // solo test automatici
  return API[environment()] || '';
}

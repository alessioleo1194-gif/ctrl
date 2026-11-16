/**
 * Indirizzi dell'API (Apps Script).
 * - Produzione: il dominio principale del sito Netlify.
 * - Test: anteprime Netlify (deploy-preview-*, rami) e sviluppo locale.
 * Gli URL si compilano dopo aver pubblicato i due progetti Apps Script (vedi docs/INSTALLAZIONE.md).
 */
export const API = {
  prod: 'https://script.google.com/macros/s/AKfycbxlAasqRDVyk2goDqfP1_cPj4_9yA2iisLPrq_Vyd2qxbcXqV5iBFYA8nEV5I11fwgL3w/exec',
  test: 'https://script.google.com/macros/s/AKfycbwnAwUJJiy7lfQiSmbSZMyw070wOSSQdHdjuxLOu3sUDxALECUvxVByDwj7FTrxgVaS/exec'
};

/** Domini considerati produzione (il sito Netlify principale). */
export const PROD_HOSTS = ['ctrl-alessioleo.netlify.app'];

export function environment(host = location.hostname) {
  if (PROD_HOSTS.includes(host)) return 'prod';
  return 'test';
}

export function apiUrl() {
  // Solo test automatici: impostato anche vuoto, sostituisce gli indirizzi reali (i test non toccano mai i server veri).
  if (typeof window !== 'undefined' && '__CTRL_API__' in window) return window.__CTRL_API__;
  return API[environment()] || '';
}

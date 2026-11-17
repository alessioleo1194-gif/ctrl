/** Quale server usa quale indirizzo: solo il sito operativo parla con la produzione. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { environment, PROD_HOSTS } from '../../app/js/config.js';

test('il sito operativo (nome definitivo e vecchio nome) usa la produzione', () => {
  assert.equal(environment('ctrl-leo.netlify.app'), 'prod');
  assert.equal(environment('ctrl-alessioleo.netlify.app'), 'prod');
  assert.deepEqual(PROD_HOSTS.sort(), ['ctrl-alessioleo.netlify.app', 'ctrl-leo.netlify.app']);
});

test('anteprime, rami, sviluppo locale e nomi simili usano il TEST', () => {
  for (const h of ['deploy-preview-5--ctrl-alessioleo.netlify.app', 'fogli-production-plan--ctrl-alessioleo.netlify.app',
    'localhost', '127.0.0.1', 'ctrl.netlify.app', 'ctrlleo.netlify.app', 'ctrl-leo.netlify.app.evil.example', 'evil-ctrl-leo.netlify.app']) {
    assert.equal(environment(h), 'test', h);
  }
});

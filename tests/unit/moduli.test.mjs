import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leggiTsv, scriviTsv } from '../../app/js/tsv.js';
import { normalizzaTempo, minutiInizio } from '../../app/js/orari.js';
import { unisciDocumento } from '../../app/js/unisci.js';

test('tsv: righe e celle come Excel, con virgolette e a-capo dentro la cella', () => {
  assert.deepEqual(leggiTsv('a\tb\nc\td\n'), [['a', 'b'], ['c', 'd']]);
  assert.deepEqual(leggiTsv('a\t\tc'), [['a', '', 'c']]);
  assert.deepEqual(leggiTsv('"riga1\nriga2"\t"dice ""ciao"""\r\nx\ty'), [['riga1\nriga2', 'dice "ciao"'], ['x', 'y']]);
  assert.deepEqual(leggiTsv('solo testo'), [['solo testo']]);
  assert.deepEqual(leggiTsv(''), []);
  assert.deepEqual(leggiTsv('a\t\n'), [['a', '']]);
});

test('tsv: scrivere e rileggere dà gli stessi valori', () => {
  const m = [['a b', 'x\ty'], ['"q"', 'due\nrighe'], ['', '1']];
  assert.deepEqual(leggiTsv(scriviTsv(m)), m);
});

test('tempo: orari e fasce scritti in fretta', () => {
  assert.equal(normalizzaTempo('1645'), '16:45');
  assert.equal(normalizzaTempo('9'), '09:00');
  assert.equal(normalizzaTempo('16.30'), '16:30');
  assert.equal(normalizzaTempo('1645-1830'), '16:45 – 18:30');
  assert.equal(normalizzaTempo('9 - 10.30'), '09:00 – 10:30');
  assert.equal(normalizzaTempo('16:00 – 18:00'), '16:00 – 18:00');
  assert.equal(normalizzaTempo('24:00'), '24:00');
  assert.equal(normalizzaTempo('26:30'), '26:30');
  assert.equal(normalizzaTempo(''), '');
  assert.equal(normalizzaTempo('30:00'), null);
  assert.equal(normalizzaTempo('12:75'), null);
  assert.equal(normalizzaTempo('ciao'), null);
  assert.equal(normalizzaTempo('1-2-3'), null);
  assert.equal(minutiInizio('16:45 – 18:30'), 16 * 60 + 45);
  assert.equal(minutiInizio(''), null);
});

const R = (id, o = {}) => ({ id, sez: '', ora: '', att: '', loc: '', note: '', ...o });
const PLAN = (righe, crew = []) => ({ lingua: 'en', crew, giorni: [{ id: 'g', data: '2026-11-20', righe }] });

test('unione: modifiche a campi diversi della stessa riga si sommano; sullo stesso campo vince la mia', () => {
  const base = PLAN([R('a', { ora: '10:00', att: 'Setup' })]);
  const mio = PLAN([R('a', { ora: '10:00', att: 'Load-in' })]);
  const loro = PLAN([R('a', { ora: '11:00', att: 'Setup', note: 'x' })]);
  const u = unisciDocumento('plan', base, mio, loro);
  assert.deepEqual(u.giorni[0].righe[0], R('a', { ora: '11:00', att: 'Load-in', note: 'x' }));
  const mio2 = PLAN([R('a', { ora: '12:00', att: 'Setup' })]);
  assert.equal(unisciDocumento('plan', base, mio2, loro).giorni[0].righe[0].ora, '12:00');
});

test('unione: righe nuove di entrambi restano, righe tolte restano tolte, ordine mio rispettato', () => {
  const base = PLAN([R('a'), R('b'), R('c')]);
  const mio = PLAN([R('c'), R('a'), R('n1', { att: 'mia' })]); // ho tolto b, riordinato, aggiunto n1
  const loro = PLAN([R('a'), R('b', { att: 'modificata da loro' }), R('c'), R('n2', { att: 'loro' })]);
  const u = unisciDocumento('plan', base, mio, loro).giorni[0].righe.map(r => r.id);
  assert.deepEqual(u, ['c', 'a', 'n1', 'n2'].sort((x, y) => u.indexOf(x) - u.indexOf(y)));
  assert.ok(!u.includes('b'));
  assert.ok(u.includes('n1') && u.includes('n2'));
  assert.equal(u.indexOf('c') < u.indexOf('a'), true);
});

test('unione: una riga tolta da loro ma modificata da me resta; non modificata sparisce', () => {
  const base = PLAN([R('a', { att: 'x' }), R('b', { att: 'y' })]);
  const mio = PLAN([R('a', { att: 'x' }), R('b', { att: 'y2' })]);
  const loro = PLAN([]);
  assert.deepEqual(unisciDocumento('plan', base, mio, loro).giorni[0].righe.map(r => r.id), ['b']);
});

test('unione: crew e materiali', () => {
  const c = (id, nome) => ({ id, nome, ruolo: '', telefono: '', email: '' });
  const u = unisciDocumento('plan', PLAN([], [c('1', 'A')]), PLAN([], [c('1', 'A'), c('2', 'B')]), PLAN([], [c('1', 'A2'), c('3', 'C')]));
  assert.deepEqual(u.crew.map(x => x.nome).sort(), ['A2', 'B', 'C']);
  const m = (voce) => ({ id: 'm', voce, qta: '', unita: '', note: '' });
  const S = (righe) => ({ sezioni: [{ id: 's', nome: 'FOH', righe }] });
  const um = unisciDocumento('materiali', S([m('a')]), S([m('a'), { ...m('b'), id: 'n' }]), S([m('a2')]));
  assert.deepEqual(um.sezioni[0].righe.map(r => r.voce), ['a2', 'b']);
});

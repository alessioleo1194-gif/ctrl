// Unisce i file di backend/src in un unico file da incollare nell'editor Apps Script.
// Uso: node scripts/build-backend.mjs        → scrive backend/dist/Codice.gs
//      node scripts/build-backend.mjs --check → errore se il file non è aggiornato (usato dai test automatici)
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const src = path.join(root, 'backend/src');
const out = path.join(root, 'backend/dist/Codice.gs');
const files = fs.readdirSync(src).filter(f => f.endsWith('.js')).sort();
const version = (fs.readFileSync(path.join(src, '00_Config.js'), 'utf8').match(/CTRL_VERSION = '([^']+)'/) || [])[1];
const header = `/**\n * CTRL API · versione ${version}\n * FILE GENERATO da scripts/build-backend.mjs a partire da backend/src: non modificarlo a mano.\n * Per aggiornare il server: incolla tutto il contenuto al posto di Codice.gs nell'editor Apps Script,\n * salva, poi Esegui il deployment > Gestisci deployment > modifica > Nuova versione.\n */\n`;
const body = files.map(f => `\n// ===== ${f} =====\n` + fs.readFileSync(path.join(src, f), 'utf8').trimEnd() + '\n').join('');
const content = header + body;

// Le regole del programma servono anche all'app: stessa sorgente, copiata come modulo ES.
const progSrc = path.join(src, '24_Programma.js');
const progOut = path.join(root, 'app/js/programma.js');
const progContent = '// FILE GENERATO da scripts/build-backend.mjs a partire da backend/src/24_Programma.js: non modificarlo a mano.\n' +
  fs.readFileSync(progSrc, 'utf8').trimEnd() + '\n\nexport default Programma;\n';

if (process.argv.includes('--check')) {
  const cur = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  if (cur !== content) { console.error('backend/dist/Codice.gs non è aggiornato: esegui npm run build'); process.exit(1); }
  const curProg = fs.existsSync(progOut) ? fs.readFileSync(progOut, 'utf8') : '';
  if (curProg !== progContent) { console.error('app/js/programma.js non è aggiornato: esegui npm run build'); process.exit(1); }
  console.log('backend/dist/Codice.gs e app/js/programma.js aggiornati');
} else {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, content);
  fs.writeFileSync(progOut, progContent);
  console.log('Scritto ' + path.relative(root, out) + ' (' + files.length + ' moduli, versione ' + version + ')');
}

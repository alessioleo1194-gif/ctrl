/**
 * Simulatore in memoria dei servizi Google usati da CTRL (Sheets, Calendar, Drive,
 * Cache, Lock, Properties, Utilities, MailApp, ScriptApp, ContentService, Session).
 * Riproduce i comportamenti che contano per i test, compresa la conversione
 * automatica dei numeri nelle celle NON formattate come testo.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

function formatDate(date, tz, pattern) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(date).map(p => [p.type, p.value]));
  if (parts.hour === '24') parts.hour = '00';
  return pattern
    .replace(/'T'/g, 'T')
    .replace('yyyy', parts.year).replace('MM', parts.month).replace('dd', parts.day)
    .replace('HH', parts.hour).replace('mm', parts.minute).replace('ss', parts.second);
}

class Range {
  constructor(sheet, r, c, nr = 1, nc = 1) { Object.assign(this, { sheet, r, c, nr, nc }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = [];
      for (let j = 0; j < this.nc; j++) row.push(this.sheet.cell(this.r + i, this.c + j));
      out.push(row);
    }
    return out;
  }
  setValues(vals) {
    vals.forEach((row, i) => row.forEach((v, j) => this.sheet.write(this.r + i, this.c + j, v)));
    return this;
  }
  setValue(v) { this.sheet.write(this.r, this.c, v); return this; }
  setNumberFormat(f) {
    for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sheet.formats.set(`${this.r + i}:${this.c + j}`, f);
    return this;
  }
  setFontWeight() { return this; }
}

class Sheet {
  constructor(name) { this.name = name; this.data = []; this.formats = new Map(); this.maxRows = 1000; }
  getName() { return this.name; }
  cell(r, c) { const row = this.data[r - 1]; const v = row ? row[c - 1] : undefined; return v === undefined ? '' : v; }
  write(r, c, v) {
    while (this.data.length < r) this.data.push([]);
    const row = this.data[r - 1];
    while (row.length < c) row.push('');
    const fmt = this.formats.get(`${r}:${c}`);
    if (fmt !== '@' && typeof v === 'string' && /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(v.trim()) && v.trim() !== '') {
      v = Number(v); // come Google Sheets: testo numerico diventa numero
    }
    row[c - 1] = v;
  }
  getLastRow() {
    for (let i = this.data.length; i > 0; i--) if (this.data[i - 1].some(v => v !== '' && v !== undefined)) return i;
    return 0;
  }
  getLastColumn() { return this.data.reduce((m, r) => Math.max(m, r.length), 0); }
  getMaxRows() { return Math.max(this.maxRows, this.data.length); }
  getRange(r, c, nr, nc) { return new Range(this, r, c, nr, nc); }
  getDataRange() {
    const lr = this.getLastRow(), lc = this.getLastColumn();
    return new Range(this, 1, 1, Math.max(lr, 1), Math.max(lc, 1));
  }
  setFrozenRows() {}
  deleteRow(r) { this.data.splice(r - 1, 1); }
  rows() { return this.data; }
}

class Spreadsheet {
  constructor(id) { this.id = id; this.sheets = [new Sheet('Foglio1')]; this.tz = 'America/Los_Angeles'; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(n) { const s = new Sheet(n); this.sheets.push(s); return s; }
  getSheets() { return this.sheets.slice(); }
  deleteSheet(s) { this.sheets = this.sheets.filter(x => x !== s); }
  setSpreadsheetTimeZone(tz) { this.tz = tz; }
}

export class CalEvent {
  constructor(o) { this.o = o; }
  getId() { return this.o.id; }
  getTitle() { return this.o.title || ''; }
  isAllDayEvent() { return !!this.o.allDay; }
  isRecurringEvent() { return !!this.o.recurring; }
  getStartTime() { return new Date(this.o.start); }
  getEndTime() { return new Date(this.o.end); }
  // Apps Script restituisce la mezzanotte nel fuso dello script
  getAllDayStartDate() { return new Date(this.o.start + 'T12:00:00Z'); }
  getAllDayEndDate() { return new Date(this.o.end + 'T12:00:00Z'); }
  getLocation() { return this.o.location || ''; }
  getDescription() { return this.o.description || ''; }
  getColor() { return this.o.color || ''; }
}

export function createGoogle({ adminEmail = 'admin@example.com', calendarEvents = [] } = {}) {
  const state = {
    props: {}, cache: new Map(), mails: [], triggers: [], spreadsheets: new Map(), now: () => Date.now(),
    calendar: { id: 'cal@group.calendar.google.com', color: '#9fc6e7', events: calendarEvents },
    drive: { files: new Map(), folders: new Map() }, adminEmail, logs: []
  };
  const getSS = id => { if (!state.spreadsheets.has(id)) state.spreadsheets.set(id, new Spreadsheet(id)); return state.spreadsheets.get(id); };

  const google = {
    PropertiesService: { getScriptProperties: () => ({
      getProperties: () => ({ ...state.props }),
      setProperties: (o) => { Object.assign(state.props, o); }
    }) },
    SpreadsheetApp: { openById: getSS, flush: () => {} },
    CacheService: { getScriptCache: () => ({
      get: k => { const e = state.cache.get(k); if (!e) return null; if (e.exp < state.now()) { state.cache.delete(k); return null; } return e.v; },
      put: (k, v, ttl = 600) => { state.cache.set(k, { v: String(v), exp: state.now() + ttl * 1000 }); },
      remove: k => { state.cache.delete(k); }
    }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(String(s), 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
      formatDate
    },
    MailApp: { sendEmail: (o) => { state.mails.push(o); } },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (t) => ({ text: t, setMimeType() { return this; }, getContent() { return t; } })
    },
    Session: { getEffectiveUser: () => ({ getEmail: () => state.adminEmail }) },
    CalendarApp: { getCalendarById: (id) => id === state.props.CALENDAR_ID ? {
      getColor: () => state.calendar.color,
      getEvents: (from, to) => state.calendar.events
        .filter(e => {
          const s = e.allDay ? new Date(e.start + 'T00:00:00Z') : new Date(e.start);
          const en = e.allDay ? new Date(e.end + 'T00:00:00Z') : new Date(e.end);
          return en > from && s < to;
        })
        .map(e => new CalEvent(e))
    } : null },
    ScriptApp: {
      WeekDay: { MONDAY: 'MONDAY' },
      getProjectTriggers: () => state.triggers.map(t => ({ getHandlerFunction: () => t.fn, _t: t })),
      deleteTrigger: (t) => { state.triggers = state.triggers.filter(x => x !== t._t); },
      newTrigger: (fn) => {
        const t = { fn };
        const b = { timeBased: () => b, everyHours: (n) => { t.every = n + 'h'; return b; }, everyDays: (n) => { t.every = n + 'd'; return b; },
          onWeekDay: (d) => { t.day = d; return b; }, atHour: (h) => { t.hour = h; return b; }, create: () => { state.triggers.push(t); return t; } };
        return b;
      }
    },
    DriveApp: {
      getFolderById: (id) => {
        if (!state.drive.folders.has(id)) state.drive.folders.set(id, []);
        const list = state.drive.folders.get(id);
        return { getId: () => id, getFiles: () => { let i = 0; const arr = list.filter(f => !f.trashed); return { hasNext: () => i < arr.length, next: () => arr[i++].api }; } };
      },
      getFileById: (id) => ({
        makeCopy: (name, folder) => {
          const f = { name, trashed: false };
          f.api = { getName: () => f.name, setTrashed: (v) => { f.trashed = v; } };
          state.drive.folders.get(folder.getId()).push(f);
          return f.api;
        }
      })
    },
    console: { log: (...a) => state.logs.push(a.join(' ')), error: (...a) => state.logs.push('ERR ' + a.join(' ')), warn: () => {} }
  };
  return { google, state, getSS };
}

/** Carica il backend in un contesto isolato con i servizi simulati. */
export function loadBackend(opts = {}) {
  const { google, state, getSS } = createGoogle(opts);
  const base = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../backend');
  const ctx = vm.createContext({ ...google, Date, Math, JSON, Object, Array, String, Number, parseInt, isNaN, Error, RegExp });
  if (opts.dist) {
    // il file unico che si incolla in Apps Script
    vm.runInContext(fs.readFileSync(path.join(base, 'dist/Codice.gs'), 'utf8'), ctx, { filename: 'Codice.gs' });
  } else {
    const dir = path.join(base, 'src');
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort();
    for (const f of files) vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
  }
  return { ctx, state, getSS };
}

/** Helper: chiama l'API come farebbe il frontend. */
export function call(ctx, action, payload, token) {
  // come una vera risposta HTTP: passa per JSON (evita anche oggetti di un altro contesto)
  return JSON.parse(JSON.stringify(ctx.handleRequest(JSON.stringify({ action, payload, token }))));
}

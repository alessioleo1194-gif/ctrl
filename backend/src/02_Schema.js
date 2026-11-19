/**
 * CTRL · Struttura del database (una scheda del foglio per tabella).
 *
 * Regole:
 * - le colonne si AGGIUNGONO in fondo, mai rinominate o tolte (setup è idempotente);
 * - ogni cella è testo (formato "@"), così id, date e orari non vengono convertiti;
 * - nessuna riga viene cancellata: si usa stato/eliminato.
 */
var SCHEMA_VERSION = 9;

var SCHEMA = {
  eventi: ['id', 'origine', 'cal_key', 'titolo', 'data', 'data_fine', 'ora_inizio', 'ora_fine', 'luogo',
    'descrizione', 'colore', 'progetto_id', 'cartella_id', 'stato', 'note',
    'creato_il', 'creato_da', 'aggiornato_il', 'aggiornato_da', 'versione', 'sync_il',
    // correzioni a mano di un evento del Calendar: modificati = { campo: valore che diceva il Calendar }, cal_diff = { campo: nuovo valore del Calendar } (JSON)
    'modificati', 'cal_diff'],
  // programma della produzione (Production Schedule). evento_id resta per compatibilità, non si usa più.
  attivita: ['id', 'evento_id', 'ora_inizio', 'ora_fine', 'attivita', 'responsabile', 'note', 'ordine',
    'eliminato', 'creato_il', 'aggiornato_il', 'aggiornato_da', 'versione', 'progetto_id', 'giornata_id', 'spazio_id', 'tipo'],
  materiale: ['id', 'evento_id', 'voce', 'quantita', 'area', 'provenienza', 'fornitore', 'note', 'ordine',
    'eliminato', 'creato_il', 'aggiornato_il', 'aggiornato_da', 'versione'],
  canali: ['id', 'evento_id', 'numero', 'sorgente', 'microfono', 'di', 'asta', 'note', 'ordine',
    'eliminato', 'creato_il', 'aggiornato_il', 'aggiornato_da', 'versione'],
  testi: ['id', 'evento_id', 'sezione', 'testo', 'aggiornato_il', 'aggiornato_da', 'versione'],
  allegati: ['id', 'evento_id', 'sezione', 'drive_id', 'nome', 'mime', 'byte', 'caricato_da', 'caricato_il',
    'nel_cestino'],
  // progetti = produzioni (scheda di produzione): uno o più eventi collegati con eventi.progetto_id
  progetti: ['id', 'nome', 'tipo', 'data', 'data_fine', 'cartella_id', 'stato', 'creato_il', 'aggiornato_il',
    'versione', 'creato_da', 'aggiornato_da', 'eliminato', 'note'],
  // location = spazi della produzione (palchi, sale, magazzino, venue)
  location: ['id', 'progetto_id', 'nome', 'indirizzo', 'note', 'versione', 'tipo', 'ordine', 'eliminato', 'creato_il',
    'aggiornato_il', 'aggiornato_da'],
  giornate: ['id', 'progetto_id', 'data', 'etichetta', 'ordine', 'eliminato', 'creato_il', 'aggiornato_il',
    'aggiornato_da', 'versione', 'note'],
  // rubrica comune a tutte le produzioni
  persone: ['id', 'nome', 'ruolo', 'telefono', 'email', 'azienda', 'note', 'eliminato', 'creato_il', 'creato_da',
    'aggiornato_il', 'aggiornato_da', 'versione'],
  squadra: ['id', 'progetto_id', 'persona_id', 'ruolo', 'giornata_id', 'spazio_id', 'note', 'ordine', 'eliminato',
    'creato_il', 'aggiornato_il', 'aggiornato_da', 'versione'],
  // documenti operativi di una produzione (Production Plan, Material List): JSON spezzato in parti
  documenti: ['id', 'progetto_id', 'tipo', 'versione', 'parti', 'creato_il', 'creato_da', 'aggiornato_il', 'aggiornato_da', 'eliminato'],
  documenti_parti: ['id', 'documento_id', 'n', 'testo'],
  // scade_il: ultimo giorno di accesso (yyyy-MM-dd, ora italiana); vuoto = nessuna scadenza
  // nome_calendario: come la persona compare nelle descrizioni del Calendar (alias separati da virgola)
  // colore: uno di COLORI_UTENTE, uguale per la stessa persona ovunque nell'interfaccia
  utenti: ['id', 'email', 'nome', 'ruolo', 'puo_caricare', 'puo_modificare', 'attivo', 'creato_il',
    'aggiornato_il', 'versione', 'ultimo_accesso', 'scade_il', 'nome_calendario', 'colore',
    // permessi_extra: eccezioni al ruolo, separate da virgola (tutti_documenti, carica, modifica). eliminato: TRUE = utente tolto (riga conservata).
    'permessi_extra', 'eliminato', 'eliminato_il'],
  // staff assegnato agli eventi. stato: proposta (da confermare), confermata, scartata, rimossa, decaduta.
  // origine: calendario (trovato nella descrizione) o manuale. trovato/termine: dove e cosa è stato trovato.
  assegnazioni: ['id', 'evento_id', 'email', 'stato', 'origine', 'trovato', 'termine', 'creata_il', 'creata_da',
    'aggiornata_il', 'aggiornata_da',
    // giorni_tutti: TRUE = lavora in tutte le giornate dell'evento (anche quelle che nascono dopo); FALSE = solo i turni indicati
    'giorni_tutti'],
  // giornate di un evento: una riga per evento e data. Gli orari in vigore sono ora_inizio/ora_fine; cal_* è l'ultimo orario
  // letto dal Calendar, cal_base quello che il Calendar diceva quando l'orario è stato corretto a mano ("inizio|fine").
  // origine: calendario (nata dal Calendar) o manuale (aggiunta a mano). origine_orario: calendario o manuale.
  // stato: attiva · fuori_calendario (non più nel Calendar ma con modifiche o staff). Fine prima dell'inizio = finisce il giorno dopo.
  giorni: ['id', 'evento_id', 'data', 'ora_inizio', 'ora_fine', 'origine', 'origine_orario', 'cal_inizio', 'cal_fine', 'cal_base',
    'nota', 'stato', 'eliminato', 'creato_il', 'aggiornato_il', 'aggiornato_da', 'versione'],
  // turni: una riga per tecnico e per giornata (è anche lo Staff Work Report: nessun archivio a parte).
  // ora_inizio/ora_fine vuoti = segue la giornata. Orari sempre pianificati. Nessuna riga si cancella: eliminato.
  turni: ['id', 'evento_id', 'giorno_id', 'email', 'ora_inizio', 'ora_fine', 'nota', 'eliminato', 'creato_il', 'creato_da',
    'aggiornato_il', 'aggiornato_da', 'versione'],
  sessioni: ['hash', 'email', 'creata', 'scade', 'ultimo_uso', 'dispositivo'],
  condivisioni: ['id', 'hash', 'eventi', 'sezioni', 'mostra_contatti', 'scade', 'revocato', 'creato_da',
    'creato_il', 'ultimo_accesso', 'etichetta'],
  // richieste di accesso fatte da chi non ha ancora un account (stato: in_attesa, approvata, rifiutata)
  richieste_accesso: ['id', 'email', 'nome', 'messaggio', 'creata_il', 'stato', 'gestita_il', 'gestita_da', 'ruolo', 'scade_il'],
  // registro accessi: solo aggiunta, le righe oltre 180 giorni si cancellano da sole (come le sessioni)
  accessi: ['ts', 'email', 'evento', 'esito', 'dispositivo', 'dettaglio', 'attore'],
  storico: ['ts', 'email', 'evento_id', 'sezione', 'azione', 'rif_id', 'prima', 'dopo'],
  config: ['chiave', 'valore', 'aggiornato_il']
};

// OWNER è solo l'email in ADMIN_EMAIL e non si assegna dal portale.
var RUOLI = ['OWNER', 'PRODUCTION', 'VIEWER'];
var RUOLI_ASSEGNABILI = ['PRODUCTION', 'VIEWER'];
var COLORI_UTENTE = ['blu', 'verde', 'arancio', 'viola', 'rosa', 'turchese', 'giallo', 'rosso'];
var STATI_EVENTO = ['attivo', 'annullato', 'archiviato'];

var LISTE_DEFAULT = {
  aree: ['Audio', 'Luci', 'Video', 'Backline', 'Rigging', 'Venue', 'Altro'],
  provenienze: ['CoolClub', 'Da noleggiare', 'Fornito da terzi', 'Da altro magazzino', 'Da verificare']
};

/**
 * CTRL · Struttura del database (una scheda del foglio per tabella).
 *
 * Regole:
 * - le colonne si AGGIUNGONO in fondo, mai rinominate o tolte (setup è idempotente);
 * - ogni cella è testo (formato "@"), così id, date e orari non vengono convertiti;
 * - nessuna riga viene cancellata: si usa stato/eliminato.
 */
var SCHEMA_VERSION = 2;

var SCHEMA = {
  eventi: ['id', 'origine', 'cal_key', 'titolo', 'data', 'data_fine', 'ora_inizio', 'ora_fine', 'luogo',
    'descrizione', 'colore', 'progetto_id', 'cartella_id', 'stato', 'note',
    'creato_il', 'creato_da', 'aggiornato_il', 'aggiornato_da', 'versione', 'sync_il'],
  attivita: ['id', 'evento_id', 'ora_inizio', 'ora_fine', 'attivita', 'responsabile', 'note', 'ordine',
    'eliminato', 'creato_il', 'aggiornato_il', 'aggiornato_da', 'versione'],
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
    'aggiornato_da', 'versione'],
  // rubrica comune a tutte le produzioni
  persone: ['id', 'nome', 'ruolo', 'telefono', 'email', 'azienda', 'note', 'eliminato', 'creato_il', 'creato_da',
    'aggiornato_il', 'aggiornato_da', 'versione'],
  squadra: ['id', 'progetto_id', 'persona_id', 'ruolo', 'giornata_id', 'spazio_id', 'note', 'ordine', 'eliminato',
    'creato_il', 'aggiornato_il', 'aggiornato_da', 'versione'],
  utenti: ['id', 'email', 'nome', 'ruolo', 'puo_caricare', 'puo_modificare', 'attivo', 'creato_il',
    'aggiornato_il', 'versione', 'ultimo_accesso'],
  sessioni: ['hash', 'email', 'creata', 'scade', 'ultimo_uso', 'dispositivo'],
  condivisioni: ['id', 'hash', 'eventi', 'sezioni', 'mostra_contatti', 'scade', 'revocato', 'creato_da',
    'creato_il', 'ultimo_accesso', 'etichetta'],
  storico: ['ts', 'email', 'evento_id', 'sezione', 'azione', 'rif_id', 'prima', 'dopo'],
  config: ['chiave', 'valore', 'aggiornato_il']
};

var RUOLI = ['ADMIN', 'COLLABORATORE', 'LETTURA'];
var STATI_EVENTO = ['attivo', 'annullato', 'archiviato'];

var LISTE_DEFAULT = {
  aree: ['Audio', 'Luci', 'Video', 'Backline', 'Rigging', 'Venue', 'Altro'],
  provenienze: ['CoolClub', 'Da noleggiare', 'Fornito da terzi', 'Da altro magazzino', 'Da verificare']
};

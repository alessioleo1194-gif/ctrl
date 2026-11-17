import { api, session } from '../api.js';
import { h } from '../ui.js';

/** Accesso in due passaggi: email → codice di 6 cifre ricevuto per email. */
export function renderLogin(root, onDone) {
  let email = '';
  try { email = localStorage.getItem('ctrl.email') || ''; } catch { /* nessuno storage */ }

  const msg = h('div', { class: 'help', role: 'alert' });
  const box = h('div', { class: 'box' });
  root.replaceChildren(h('main', { class: 'login' }, box));

  function head(sub) {
    return [
      h('div', {}, h('span', { class: 'keycap lg' }, 'CTRL')),
      h('p', { class: 'claim' }, sub)
    ];
  }

  function setMsg(text, isErr) { msg.textContent = text || ''; msg.className = isErr ? 'err' : 'help'; }

  function stepEmail() {
    const input = h('input', { class: 'input', type: 'email', name: 'email', autocomplete: 'email', inputmode: 'email', required: true, value: email, placeholder: 'nome@esempio.it' });
    const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Invia codice');
    const form = h('form', { class: 'box', novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      const v = input.value.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return setMsg('Inserisci un indirizzo email valido.', true);
      btn.disabled = true; btn.textContent = 'Invio…'; setMsg('');
      try {
        await api('auth.requestCode', { email: v });
        email = v;
        try { localStorage.setItem('ctrl.email', v); } catch { /* ok */ }
        stepCode('Se l\'indirizzo è autorizzato, riceverai un codice entro un minuto. Controlla anche lo spam.');
      } catch (err) {
        setMsg(err.message, true);
      } finally { btn.disabled = false; btn.textContent = 'Invia codice'; }
    } },
    head('Centro di comando della produzione eventi.'),
    h('label', { class: 'field' }, h('span', {}, 'Email'), input),
    btn, msg,
    h('div', { class: 'alt' }, h('button', { type: 'button', onclick: () => { email = input.value.trim().toLowerCase() || email; setMsg(''); stepRichiesta(); } }, 'Non hai ancora l\'accesso? Richiedilo')));
    box.replaceChildren(form);
    input.focus();
  }

  /** Richiesta di accesso: la risposta è sempre la stessa, esista o no un account con quell'email. */
  function stepRichiesta() {
    const mail = h('input', { class: 'input', type: 'email', name: 'email', autocomplete: 'email', inputmode: 'email', required: true, value: email, placeholder: 'nome@esempio.it' });
    const nome = h('input', { class: 'input', name: 'nome', autocomplete: 'name', maxlength: '80' });
    const testo = h('input', { class: 'input', name: 'messaggio', maxlength: '300', placeholder: 'Chi sei e perché ti serve' });
    const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Invia richiesta');
    const form = h('form', { class: 'box', novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      const v = mail.value.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return setMsg('Inserisci un indirizzo email valido.', true);
      btn.disabled = true; btn.textContent = 'Invio…'; setMsg('');
      try {
        await api('accesso.richiedi', { email: v, nome: nome.value, messaggio: testo.value, dispositivo: navigator.userAgent.slice(0, 120) });
        email = v;
        box.replaceChildren(h('div', { class: 'box' },
          head('Richiesta inviata'),
          h('p', { class: 'help', role: 'status' }, 'Se l\'email è autorizzata riceverai il codice dal login. Quando la richiesta verrà approvata potrai accedere con il normale codice via email.'),
          h('button', { class: 'btn block', type: 'button', onclick: () => { setMsg(''); stepEmail(); } }, 'Torna all\'accesso')));
      } catch (err) {
        setMsg(err.message, true);
        btn.disabled = false; btn.textContent = 'Invia richiesta';
      }
    } },
    head('Richiedi accesso a CTRL'),
    h('label', { class: 'field' }, h('span', {}, 'La tua email'), mail),
    h('label', { class: 'field' }, h('span', {}, 'Nome'), nome),
    h('label', { class: 'field' }, h('span', {}, 'Messaggio (facoltativo)'), testo),
    btn, msg,
    h('div', { class: 'alt' }, h('button', { type: 'button', onclick: () => { setMsg(''); stepEmail(); } }, '← Torna al login')));
    box.replaceChildren(form);
    mail.focus();
  }

  function stepCode(info) {
    const input = h('input', { class: 'input mono', type: 'text', name: 'code', inputmode: 'numeric', autocomplete: 'one-time-code', pattern: '[0-9]{6}', maxlength: '6', required: true, placeholder: '000000', style: { letterSpacing: '.4em', fontSize: '22px', textAlign: 'center' } });
    const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Accedi');
    setMsg(info);
    const form = h('form', { class: 'box', novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      const code = input.value.replace(/\D/g, '');
      if (code.length !== 6) return setMsg('Il codice ha 6 cifre.', true);
      btn.disabled = true; btn.textContent = 'Verifica…';
      try {
        const res = await api('auth.verifyCode', { email, code, dispositivo: navigator.userAgent.slice(0, 120) });
        session.token = res.token;
        await onDone(res.utente);
      } catch (err) {
        setMsg(err.message, true);
        if (err.code === 'CODE_EXPIRED') input.value = '';
      } finally { btn.disabled = false; btn.textContent = 'Accedi'; }
    } },
    head('Codice inviato a ' + email),
    h('label', { class: 'field' }, h('span', {}, 'Codice di accesso'), input),
    btn, msg,
    h('div', { class: 'row' },
      h('button', { class: 'btn ghost', type: 'button', onclick: () => { setMsg(''); stepEmail(); } }, 'Cambia email'),
      h('button', { class: 'btn ghost', type: 'button', onclick: async (e) => {
        e.target.disabled = true;
        try { await api('auth.requestCode', { email }); setMsg('Nuovo codice inviato.'); }
        catch (err) { setMsg(err.message, true); }
        finally { e.target.disabled = false; }
      } }, 'Invia di nuovo')));
    box.replaceChildren(form);
    input.addEventListener('input', () => { if (input.value.replace(/\D/g, '').length === 6) form.requestSubmit(); });
    input.focus();
  }

  stepEmail();
}

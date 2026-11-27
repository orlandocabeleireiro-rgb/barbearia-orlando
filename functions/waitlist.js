// Barbearia Orlando — lista de espera automática (usado por index.js)
//
// Quando uma vaga abre (um busy_slot é apagado) ou entra um pedido novo na
// lista de espera, procura os pedidos pendentes desse dia e marca o primeiro
// que tenha uma das horas preferidas livre. Faz as mesmas contas que o site
// (horário 09:00–13:00 e 14:30–19:30, slots de 30 min, horas fechadas) e cria
// a marcação numa transação que confirma que as vagas continuam livres e que
// o pedido continua pendente — por isso nunca há marcações por cima, nem o
// mesmo pedido marcado duas vezes (mesmo que o painel admin esteja aberto e
// faça o mesmo ao mesmo tempo).

const logger = require('firebase-functions/logger');
const { sendEmailJS } = require('./reminders');

const EMAILJS_CONFIRMACAO = 'template_1fk81zm';
const SOCIAL = {
  instagram:     'https://www.instagram.com/barbeariaorlando',
  facebook:      'https://www.facebook.com/share/19JQgczoHD/',
  whatsapp:      'https://wa.me/351918871659',
  google_review: 'https://g.page/r/CRfxKw9NQw2lEAE/review'
};

const pad = n => String(n).padStart(2, '0');
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
function allSlots() {
  const s = [];
  for (let h = 9; h < 13; h++) for (let m = 0; m < 60; m += 30) s.push(`${pad(h)}:${pad(m)}`);
  for (let h = 14; h <= 19; h++) { const sm = h === 14 ? 30 : 0, em = h === 19 ? 30 : 60; for (let m = sm; m < em; m += 30) s.push(`${pad(h)}:${pad(m)}`); }
  return s;
}
function slotsFor(start, dur) {          // igual a getReq no site
  const a = allSlots(), i = a.indexOf(start); if (i === -1) return null;
  const n = (dur || 30) / 30; if (i + n > a.length) return null;
  const r = a.slice(i, i + n);
  for (let j = 1; j < r.length; j++) if (toMin(r[j]) - toMin(r[j - 1]) !== 30) return null;
  return r;
}
function isClosed(closures, barberId, dateStr, time) {   // igual a getClosureInfo no site
  return closures.some(cl => {
    if (cl.barberId !== 'all' && cl.barberId !== barberId) return false;
    if (dateStr < cl.dateStart || dateStr > cl.dateEnd) return false;
    if (cl.weekdays && cl.weekdays.length) {
      const dow = new Date(dateStr + 'T12:00:00Z').getUTCDay();
      if (!cl.weekdays.includes(dow)) return false;
    }
    if (!cl.timeStart || !cl.timeEnd) return true;
    return time >= cl.timeStart && time < cl.timeEnd;
  });
}
function lisbonNow(now = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(now).reduce((o, x) => (o[x.type] = x.value, o), {});
  return { date: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute), hm: `${p.hour}:${p.minute}` };
}
const ptDateToIso = s => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s || '').trim()); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : ''; };
const longDatePt = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString('pt-PT', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const euro = v => '€' + Number(v || 0).toFixed(2).replace('.', ',');

// Procura e marca os pedidos pendentes de um dia. Devolve quantos marcou.
async function fillWaitlistForDate(db, dateIso, { privateKey, fetchFn = fetch, now = new Date() } = {}) {
  const today = lisbonNow(now);
  if (!dateIso || dateIso < today.date) return 0;
  const [wlSnap, svcSnap, brSnap, clSnap] = await Promise.all([
    db.collection('waitlist').where('date', '==', dateIso).get(),
    db.collection('services').get(),
    db.collection('barbers').get(),
    db.collection('closures').get()
  ]);
  const pending = wlSnap.docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() }))
    .filter(w => w.status === 'pendente' && Array.isArray(w.preferredTimes) && w.preferredTimes.length)
    .sort((a, b) => (ptDateToIso(a.requestedAt) || '9999').localeCompare(ptDateToIso(b.requestedAt) || '9999') || a.id.localeCompare(b.id));
  if (!pending.length) return 0;
  const services = Object.fromEntries(svcSnap.docs.map(d => [d.id, { id: d.id, ...d.data() }]));
  const barbers = brSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const closures = clSnap.docs.map(d => d.data());
  let filled = 0;

  for (const w of pending) {
    const svc = services[w.serviceId]; if (!svc) continue;
    const dayBookings = (await db.collection('bookings').where('rawDate', '==', dateIso).get()).docs.map(d => d.data());
    if (w.clientId && dayBookings.some(b => b.clientId === w.clientId && b.status !== 'cancelada')) continue;
    const busy = new Set((await db.collection('busy_slots').where('date', '==', dateIso).get()).docs.map(d => { const x = d.data(); return x.barberId + '_' + x.time; }));
    const cands = barbers.filter(b => !b.noWaitlist && (!w.barberId || b.id === w.barberId));
    const times = [...w.preferredTimes].sort((a, b) => toMin(a) - toMin(b));
    let done = false;
    for (const time of times) {
      if (dateIso === today.date && toMin(time) <= today.min) continue;
      const need = slotsFor(time, svc.dur); if (!need) continue;
      for (const br of cands) {
        if (need.some(t => busy.has(br.id + '_' + t) || isClosed(closures, br.id, dateIso, t))) continue;
        if (dayBookings.some(b => b.barberId === br.id && b.status !== 'cancelada' && (slotsFor(b.time, services[b.serviceId]?.dur) || [b.time]).some(t => need.includes(t)))) continue;
        const booking = {
          id: uid('bk'), clientId: w.clientId || null, clientName: w.clientName || '',
          serviceId: svc.id, service: svc.name, barberId: br.id, barber: br.name,
          rawDate: dateIso, date: (w.dateLabel && w.dateLabel !== 'Invalid Date') ? w.dateLabel : longDatePt(dateIso), time, price: svc.price, status: 'confirmada',
          clientPreference: w.barberId ? 'com' : 'sem', fromWaitlist: true, createdAtMs: Date.now()
        };
        const ok = await db.runTransaction(async tx => {
          const slotRefs = need.map(t => db.collection('busy_slots').doc(`${br.id}_${dateIso}_${t}`));
          const [wNow, ...slotSnaps] = await Promise.all([tx.get(w.ref), ...slotRefs.map(r => tx.get(r))]);
          if (!wNow.exists || wNow.data().status !== 'pendente' || slotSnaps.some(s => s.exists)) return false;
          slotRefs.forEach((r, i) => tx.set(r, { barberId: br.id, date: dateIso, time: need[i] }));
          tx.set(db.collection('bookings').doc(booking.id), booking);
          tx.update(w.ref, { status: 'resolvido', resolvedAt: Date.now(), resolvedBy: 'auto' });
          return true;
        });
        if (!ok) { need.forEach(t => busy.add(br.id + '_' + t)); continue; }
        filled++; done = true;
        logger.info('Lista de espera: marcado', { waitlistId: w.id, bookingId: booking.id, barber: br.name, date: dateIso, time });
        const ln = lisbonNow();
        await db.collection('notifications').doc(uid('n')).set({
          type: 'marcacao', title: '✅ Vaga preenchida automaticamente',
          desc: `${booking.clientName} foi movido da lista de espera para ${booking.date} às ${time} (${svc.name} com ${br.name}).`,
          time: ln.hm, date: ln.date.split('-').reverse().join('/'), read: false,
          forClientId: w.clientId || null, adminOnly: false, createdAtMs: Date.now()
        }).catch(e => logger.warn('Notificação não gravada', String(e)));
        if (w.clientId && privateKey) {
          const c = await db.collection('clients').doc(w.clientId).get();
          const cl = c.exists ? c.data() : null;
          if (cl && cl.email) {
            await sendEmailJS(EMAILJS_CONFIRMACAO, {
              nome: cl.nome || '', email: cl.email, email_cliente: cl.email,
              servico: svc.name, barbeiro: br.name, data: booking.date, hora: time, preco: euro(svc.price), ...SOCIAL
            }, privateKey, fetchFn).catch(e => logger.error('Email de confirmação não enviado', { bookingId: booking.id, error: String(e) }));
          }
        }
        break;
      }
      if (done) break;
    }
  }
  return filled;
}

module.exports = { fillWaitlistForDate, slotsFor, isClosed, lisbonNow };

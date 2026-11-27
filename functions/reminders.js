// Barbearia Orlando — envio dos lembretes por email (usado por index.js)
//
// Separado da função agendada para se poder testar sem Firebase nem EmailJS.

const logger = require('firebase-functions/logger');

const EMAILJS = {
  service:   'service_bmptmfn',
  template:  'template_fkf9m6i',
  publicKey: 'dhgHhBp4LLwuLdOsf'
};
const WHATSAPP_LINK = 'https://wa.me/351918871659';

// "AAAA-MM-DD" de amanhã, em Lisboa
function tomorrowInLisbon(now = new Date()) {
  const t = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);
}

// Envia um email por um modelo do EmailJS (API REST, com a Private Key)
async function sendEmailJS(templateId, params, privateKey, fetchFn = fetch) {
  const res = await fetchFn('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: EMAILJS.service,
      template_id: templateId,
      user_id: EMAILJS.publicKey,
      accessToken: privateKey,
      template_params: params
    })
  });
  if (!res.ok) throw new Error(`EmailJS ${res.status}: ${await res.text()}`);
}
const sendReminderEmail = (params, privateKey, fetchFn) => sendEmailJS(EMAILJS.template, params, privateKey, fetchFn);

async function sendRemindersFor(db, dateIso, privateKey, fetchFn = fetch, pauseMs = 1100) {
  const snap = await db.collection('bookings').where('rawDate', '==', dateIso).get();
  const result = { sent: 0, skipped: 0, failed: 0 };
  for (const docSnap of snap.docs) {
    const b = docSnap.data();
    if (b.status !== 'confirmada' || b.reminderSentAt || !b.clientId) { result.skipped++; continue; }
    const clientSnap = await db.collection('clients').doc(b.clientId).get();
    const client = clientSnap.exists ? clientSnap.data() : null;
    if (!client || !client.email) { result.skipped++; continue; }
    try {
      await sendReminderEmail({
        nome:     client.nome || '',
        email:    client.email,
        servico:  b.service || '',
        barbeiro: b.barber || '',
        data:     b.date || dateIso,
        hora:     b.time || '',
        whatsapp: WHATSAPP_LINK
      }, privateKey, fetchFn);
      await docSnap.ref.update({ reminderSentAt: Date.now() });
      result.sent++;
    } catch (err) {
      logger.error('Lembrete não enviado', { bookingId: docSnap.id, error: String(err) });
      result.failed++;
    }
    // O EmailJS aceita cerca de 1 pedido por segundo
    if (pauseMs) await new Promise(r => setTimeout(r, pauseMs));
  }
  return result;
}

module.exports = { tomorrowInLisbon, sendRemindersFor, sendEmailJS };

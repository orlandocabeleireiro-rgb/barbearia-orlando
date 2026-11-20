// Barbearia Orlando — Cloud Functions
//
// deleteUserAccount apaga a conta de login (Firebase Auth) de um cliente ou
// administrador. É uma Callable Function: o Firebase envia automaticamente o
// token de quem está com sessão iniciada, e só aceitamos o pedido se essa
// pessoa tiver um perfil em `admins`. Não há segredo nenhum no site.
//
// Publicar: ver COMO_PUBLICAR.md

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp();

exports.deleteUserAccount = onCall({ region: 'us-central1' }, async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) {
    throw new HttpsError('unauthenticated', 'É preciso ter sessão iniciada.');
  }

  const callerAdmin = await getFirestore().collection('admins').doc(callerUid).get();
  if (!callerAdmin.exists) {
    throw new HttpsError('permission-denied', 'Só administradores podem apagar contas.');
  }

  const uid = request.data?.uid;
  if (typeof uid !== 'string' || !uid) {
    throw new HttpsError('invalid-argument', 'Falta o uid da conta a apagar.');
  }
  if (uid === callerUid) {
    throw new HttpsError('failed-precondition', 'Não podes apagar a tua própria conta.');
  }

  try {
    await getAuth().deleteUser(uid);
  } catch (err) {
    // A conta já não existe (ou nunca existiu, ex.: cliente antigo sem login)
    if (err.code === 'auth/user-not-found') return { deleted: false };
    throw new HttpsError('internal', 'Não foi possível apagar a conta.');
  }
  return { deleted: true };
});

// ── Lembrete por email no dia anterior à marcação ──
//
// sendBookingReminders corre todos os dias às 18:00 (hora de Lisboa). Procura
// as marcações confirmadas de amanhã que estejam ligadas à ficha de um cliente
// (clientId) com email, e envia a cada uma o lembrete pelo EmailJS (modelo
// "Lembrete"). Cada marcação fica com reminderSentAt, para nunca receber dois.
// A lógica está em reminders.js.
//
// A Private Key do EmailJS fica guardada como segredo no Firebase
// (EMAILJS_PRIVATE_KEY) — nunca no código. Publicar: ver COMO_PUBLICAR.md

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const { tomorrowInLisbon, sendRemindersFor } = require('./reminders');

const EMAILJS_PRIVATE_KEY = defineSecret('EMAILJS_PRIVATE_KEY');

exports.sendBookingReminders = onSchedule({
  schedule: '0 18 * * *',
  timeZone: 'Europe/Lisbon',
  region: 'us-central1',
  timeoutSeconds: 300,
  secrets: [EMAILJS_PRIVATE_KEY]
}, async () => {
  const dateIso = tomorrowInLisbon();
  const result = await sendRemindersFor(getFirestore(), dateIso, EMAILJS_PRIVATE_KEY.value());
  logger.info('Lembretes de ' + dateIso, result);
});

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

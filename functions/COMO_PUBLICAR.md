# Como publicar a Cloud Function `deleteUserAccount`

Esta função apaga a conta de login de um cliente ou administrador quando é
apagado no painel admin. Só aceita pedidos de quem tem sessão iniciada como
administrador, por isso já não precisa de segredo nenhum no site.

Tudo se faz no **Google Cloud Shell**, no browser (funciona no tablet; no
telemóvel é possível mas apertado).

## 1. Abrir o Cloud Shell

1. Abre https://shell.cloud.google.com com a conta Google do Firebase.
2. Espera até aparecer a linha de comandos (um ecrã preto com `$`).

## 2. Descarregar o código

Copia e cola esta linha e carrega em Enter:

```
rm -rf barbearia-orlando && git clone https://github.com/orlandocabeleireiro-rgb/barbearia-orlando.git && cd barbearia-orlando/functions && npm install && cd ..
```

## 3. Publicar a função nova

```
firebase deploy --only functions:deleteUserAccount --project barbearia-orlando-c660c
```

- Se aparecer um erro a pedir login, corre `firebase login --no-localhost`,
  segue o link, copia o código que aparece e cola-o no Cloud Shell. Depois
  repete o comando de cima.
- Se perguntar quantos dias guardar imagens de containers, carrega só em Enter.
- No fim deve aparecer `Deploy complete!`.

## 4. Apagar a função antiga (só depois de o site novo estar publicado)

A função antiga `deleteClientAuth` aceita qualquer pessoa que saiba o segredo,
e esse segredo esteve visível no site. Tem de ser apagada:

```
firebase functions:delete deleteClientAuth --region us-central1 --project barbearia-orlando-c660c
```

Responde `y` quando perguntar se tens a certeza.

## Como testar

No painel admin, cria um cliente de teste com um email teu, apaga-o, e
volta a registar-te com o mesmo email. Se o registo funcionar, a função
apagou a conta antiga.

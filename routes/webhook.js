const express = require('express');
const router = express.Router();
const botController = require('../controllers/botController');
const sessionManager = require('../utils/sessionManager');

router.post('/whatsapp', (req, res) => {
  const body = req.body;
  console.log('Incoming webhook payload:', JSON.stringify(body));

  if (body.object !== 'whatsapp_business_account' || !body.entry || !body.entry[0]?.changes) {
    return res.sendStatus(200);
  }

  const change = body.entry[0].changes[0];
  if (!change?.value?.messages || !change.value.messages[0]) {
    return res.sendStatus(200);
  }

  const messageObj = change.value.messages[0];
  const phone = messageObj.from;
  let message = '';
  let interactive = null;

  if (messageObj.type === 'text' && messageObj.text) {
    message = messageObj.text.body || '';
  } else if (messageObj.type === 'interactive') {
    interactive = messageObj.interactive;
    if (messageObj.interactive.button_reply) message = messageObj.interactive.button_reply.title;
    else if (messageObj.interactive.list_reply) message = messageObj.interactive.list_reply.title;
  }

  if (!message && !interactive) {
    return res.sendStatus(200);
  }

  sessionManager.get(phone); // Inicializa sesión si no existe
  botController.handleMessage(message, phone, interactive)
    .then(() => res.status(200).json({ success: true }))
    .catch(err => {
      console.error('Error processing message:', err);
      res.status(200).json({ success: false, error: err.message });
    });
});

router.get('/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const userAgent = req.get('user-agent');

  // Permitir facebookexternalhit para scraping de Meta con metadatos básicos
  if (userAgent && userAgent.includes('facebookexternalhit')) {
    res.set({
      'Content-Type': 'text/html',
      'og:title': 'Domipets WhatsApp Bot',
      'og:description': 'Webhook para el bot de WhatsApp de Domipets',
      'og:image': 'https://botwhatsappdomipets.onrender.com/public/domipets-logo.jpg', // Asegúrate de subir esta imagen a public/
      'og:url': 'https://botwhatsappdomipets.onrender.com/webhook/whatsapp'
    });
    res.status(200).send(''); // Respuesta vacía con metadatos
    return;
  }

  // Validación del webhook de WhatsApp
  if (mode === 'subscribe' && token === process.env.WHATSAPP_TOKEN) {
    console.log('Webhook verified');
    res.status(200).send(challenge);
  } else {
    res.status(403).send('Verification failed');
  }
});

module.exports = router;
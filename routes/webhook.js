const express = require('express');
const router = express.Router();
const botController = require('../controllers/botController');
const sessionManager = require('../utils/sessionManager');

router.post('/whatsapp', (req, res) => {
  const body = req.body;
  console.log('Incoming webhook payload:', JSON.stringify(body));

  if (body.object !== 'whatsapp_business_account' || !body.entry || !body.entry[0]?.changes) {
    console.log('Invalid payload structure:', JSON.stringify(body));
    return res.sendStatus(200);
  }

  const change = body.entry[0].changes[0];
  if (!change?.value?.messages || !change.value.messages[0]) {
    console.log('No messages in payload:', JSON.stringify(change.value));
    return res.sendStatus(200);
  }

  const messageObj = change.value.messages[0];
  const phone = messageObj.from;
  console.log('Extracted phone:', phone); // Nuevo log
  let message = '';
  let interactive = null;

  if (messageObj.type === 'text' && messageObj.text) {
    message = messageObj.text.body || '';
    console.log('Extracted text message:', message);
  } else if (messageObj.type === 'interactive') {
    interactive = messageObj.interactive;
    console.log('Extracted interactive message:', JSON.stringify(interactive));
    if (messageObj.interactive.button_reply) message = messageObj.interactive.button_reply.title;
    else if (messageObj.interactive.list_reply) message = messageObj.interactive.list_reply.id;
  }

  if (!message && !interactive) {
    console.log('No message or interactive content found');
    return res.sendStatus(200);
  }

  sessionManager.get(phone); // Inicializa sesión si no existe
  botController.handleMessage(message, phone, interactive)
    .then(() => {
      console.log('Message processed successfully for phone:', phone);
      res.status(200).json({ success: true });
    })
    .catch(err => {
      console.error('Error processing message for phone', phone, ':', err);
      res.status(200).json({ success: false, error: err.message });
    });
});

router.get('/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const userAgent = req.get('user-agent');

  // Permitir facebookexternalhit para scraping de Meta con una respuesta básica
  if (userAgent && userAgent.includes('facebookexternalhit')) {
    res.status(200).send(''); // Respuesta vacía para scraping
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
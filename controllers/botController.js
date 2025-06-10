// botController.js
const axios = require('axios');
const productService = require('../services/productService');
const sessionManager = require('../utils/sessionManager');
const { getPool } = require('../config/db');
require('dotenv').config();

if (!process.env.WHATSAPP_PHONE_NUMBER_ID || !process.env.WHATSAPP_ACCESS_TOKEN || !process.env.CATALOG_ID) {
  throw new Error('WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN y CATALOG_ID deben estar definidos en el archivo .env');
}

const STATES = {
  INIT: 'INIT',
  MENU: 'MENU',
  VIEW_CATALOG: 'VIEW_CATALOG',
  VIEW_CART: 'VIEW_CART',
  CONFIRM_ORDER: 'CONFIRM_ORDER',
  SUPPORT: 'SUPPORT',
  SEARCH_PRODUCTS: 'SEARCH_PRODUCTS',
};

const BUTTONS = {
  MENU: [
    { id: 'ver_catalogo', title: '🛍️ Ver catálogo' },
    { id: 'buscar_productos', title: '🔍 Buscar' },
    { id: 'hablar_agente', title: '💬 Ayuda DOMIPETS' },
    { id: 'estado_pedido', title: '🚚 Mi pedido' },
    { id: 'reiniciar', title: '🔁 Reiniciar' },
  ],
  CATALOG: [
    { id: 'ver_carrito', title: '🛒 Ver carrito' },
    { id: 'volver', title: '⬅️ Volver' },
  ],
  CART: [
    { id: 'finalizar_pedido', title: '✅ Confirmar' },
    { id: 'ver_carrito', title: '🛒 Ver carrito' },
    { id: 'ver_catalogo', title: '🛍️ Seguir comprando' },
    { id: 'volver', title: '⬅️ Volver' },
  ],
  SUPPORT: [
    { id: 'preguntas_frecuentes', title: '❓ FAQs' },
    { id: 'contactar_agente', title: '📞 Asesor DOMIPETS' },
    { id: 'volver', title: '⬅️ Volver' },
  ],
  BACK: { id: 'volver', title: '⬅️ Volver' },
};

const addBackButton = (buttons) => [...(buttons || []), BUTTONS.BACK];

const sendWhatsAppMessage = async (to, text) => {
  if (!to || !text) throw new Error('Phone number and message text are required');
  try {
    const response = await axios.post(
      `https://graph.facebook.com/v22.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
    console.log(`Text message sent to ${to}:`, response.data);
    return response.data;
  } catch (error) {
    console.error('Error sending text message:', error.response?.data || error.message);
    throw error;
  }
};

const sendWhatsAppMessageWithButtons = async (to, text, buttons) => {
  if (!to || !text) throw new Error('Phone number and message text are required');
  try {
    if (!buttons || !Array.isArray(buttons) || buttons.length === 0) {
      return await sendWhatsAppMessage(to, text);
    }
    const validButtons = buttons.map(btn => ({
      type: 'reply',
      reply: { id: btn.id, title: btn.title.length > 20 ? btn.title.substring(0, 20) : btn.title },
    })).slice(0, 3);
    const response = await axios.post(
      `https://graph.facebook.com/v22.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text },
          action: { buttons: validButtons },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
    console.log(`Button message sent to ${to}:`, response.data);
    return response.data;
  } catch (error) {
    console.error('Error sending button message:', error.response?.data || error.message);
    await sendWhatsAppMessage(to, `${text}\n(No se pudieron mostrar botones)`);
  }
};

const sendWhatsAppCatalogMessage = async (to, text) => {
  if (!to || !text) throw new Error('Phone number and message text are required');
  try {
    const response = await axios.post(
      `https://graph.facebook.com/v22.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'catalog_message',
          body: { text },
          action: {
            name: 'open',
            catalog_id: process.env.CATALOG_ID,
            sections: [],
          },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
    console.log(`Catalog message sent to ${to}:`, response.data);
    return response.data;
  } catch (error) {
    console.error('Error sending catalog message:', error.response?.data || error.message);
    await sendWhatsAppMessage(to, `${text}\n(No se pudo abrir el catálogo)`);
  }
};

const INACTIVITY_THRESHOLD_MS = 30 * 60 * 1000;

const handleMessage = async (userMessage, phone, interactiveMessage) => {
  if (!phone) throw new Error('Phone number is required');

  let session = await sessionManager.get(phone);
  const now = new Date();
  const lastActivityTime = session.lastActivity instanceof Date ? session.lastActivity.getTime() : new Date(session.lastActivity).getTime();

  if (now.getTime() - lastActivityTime > INACTIVITY_THRESHOLD_MS && session.state !== STATES.INIT) {
    await sessionManager.reset(phone);
    session = await sessionManager.get(phone);
    await sendWhatsAppMessageWithButtons(
      phone,
      '🐾 ¡Hola de nuevo! En DOMIPETS estamos listos para mimar a tu peludo. 😻 ¿En qué te ayudamos hoy?',
      BUTTONS.MENU
    );
    return;
  }

  session.cart = session.cart || [];
  session.catalog = session.catalog || { offset: 0 };
  session.errorCount = session.errorCount || 0;

  let processedMessage = (userMessage || '').trim().toLowerCase();

  if (interactiveMessage) {
    if (interactiveMessage.type === 'button_reply') {
      processedMessage = interactiveMessage.button_reply.id;
    } else if (interactiveMessage.type === 'list_reply') {
      processedMessage = interactiveMessage.list_reply.id;
    }
  } else {
    if (processedMessage.includes('catalogo') || processedMessage.includes('productos')) {
      processedMessage = 'ver_catalogo';
    } else if (processedMessage.includes('buscar') || processedMessage.includes('encontrar')) {
      processedMessage = 'buscar_productos';
    } else if (processedMessage.includes('ayuda') || processedMessage.includes('asesor')) {
      processedMessage = 'hablar_agente';
    } else if (processedMessage.includes('pedido') || processedMessage.includes('estado')) {
      processedMessage = 'estado_pedido';
    } else if (processedMessage.includes('volver') || processedMessage.includes('atras')) {
      processedMessage = 'volver';
    } else if (processedMessage.includes('reiniciar') || processedMessage.includes('inicio')) {
      processedMessage = 'reiniciar';
    }
  }

  console.log(`Processing message from ${phone}, state: ${session.state}, message: ${processedMessage}`);

  let response;
  try {
    if (
      processedMessage &&
      !['ver_catalogo', 'buscar_productos', 'hablar_agente', 'estado_pedido', 'ver_carrito', 'finalizar_pedido', 'volver', 'reiniciar'].some(id => processedMessage.startsWith(id) || processedMessage === id) &&
      isNaN(parseInt(processedMessage))
    ) {
      session.errorCount += 1;
      await sessionManager.update(phone, session);
      if (session.errorCount >= 3) {
        session.state = STATES.MENU;
        session.errorCount = 0;
        response = { text: '😿 ¡Ups! Parece que te perdiste. Volvemos al menú de DOMIPETS. 🐾 ¿Qué quieres hacer?', buttons: BUTTONS.MENU };
        await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
        await sessionManager.update(phone, session);
        return;
      }
    } else {
      session.errorCount = 0;
      await sessionManager.update(phone, session);
    }

    const handleInit = async () => {
      session.state = STATES.MENU;
      response = { text: '🐾 ¡Bienvenid@ a DOMIPETS! Somos tu tienda favorita para consentir a tu peludo. 😻 ¿En qué te ayudamos hoy?', buttons: BUTTONS.MENU };
      await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
      await sessionManager.update(phone, session);
    };

    const handleMenu = async () => {
      if (processedMessage === 'ver_catalogo') {
        session.state = STATES.VIEW_CATALOG;
        await sessionManager.update(phone, session);
        response = { text: '🛍️ Explora el catálogo de DOMIPETS y elige tus productos:', buttons: [{ id: 'open_catalog', title: '📦 Ver catálogo' }, { id: 'volver', title: '⬅️ Volver' }] };
      } else if (processedMessage === 'buscar_productos') {
        session.state = STATES.SEARCH_PRODUCTS;
        response = { text: '🔍 Escribe el nombre o descripción del producto que buscas en DOMIPETS:', buttons: addBackButton([]) };
      } else if (processedMessage === 'hablar_agente') {
        session.state = STATES.SUPPORT;
        response = { text: '💬 ¿En qué puede ayudarte el equipo de DOMIPETS?', buttons: BUTTONS.SUPPORT };
      } else if (processedMessage === 'estado_pedido') {
        session.state = STATES.SUPPORT;
        session.supportAction = 'order_status';
        response = { text: '🚚 Ingresa el número de tu pedido en DOMIPETS:', buttons: addBackButton([]) };
      } else if (processedMessage === 'reiniciar') {
        response = await handleReset(phone);
      } else {
        response = { text: '🐾 ¿En qué te ayudamos hoy en DOMIPETS? 😻', buttons: BUTTONS.MENU };
      }
      if (response) await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
    };

    const handleViewCatalog = async () => {
      if (processedMessage === 'open_catalog') {
        await sendWhatsAppCatalogMessage(phone, '🛍️ Aquí tienes el catálogo completo de DOMIPETS. Explora y añade productos al carrito:');
        response = { text: '📦 Una vez que añadas productos al carrito, usa "Ver carrito" para continuar. ¿Qué más necesitas?', buttons: [{ id: 'ver_carrito', title: '🛒 Ver carrito' }, { id: 'volver', title: '⬅️ Volver' }] };
      } else if (processedMessage === 'ver_carrito') {
        session.state = STATES.VIEW_CART;
        await sessionManager.update(phone, session);
        if (!session.cart || session.cart.length === 0) {
          response = { text: '🛒 ¡Tu carrito en DOMIPETS está vacío! Añade productos desde el catálogo.', buttons: [{ id: 'ver_catalogo', title: '🛍️ Ver catálogo' }, { id: 'volver', title: '⬅️ Volver' }] };
        } else {
          const cartTotal = session.cart.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2);
          response = {
            text: `🛒 Tu carrito en DOMIPETS:\n${session.cart.map(item => `${item.quantity} x ${item.title} - $${(item.price * item.quantity).toFixed(2)}`).join('\n')}\n💰 Total: $${cartTotal}\n¿Confirmas tu pedido?`,
            buttons: BUTTONS.CART,
          };
        }
      } else if (processedMessage === 'volver') {
        session.state = STATES.MENU;
        await sessionManager.update(phone, session);
        response = { text: '🐾 ¿En qué te ayudamos hoy en DOMIPETS? 😻', buttons: BUTTONS.MENU };
      }
      if (response) await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
    };

    const handleViewCart = async () => {
      if (processedMessage === 'finalizar_pedido') {
        if (!session.cart || session.cart.length === 0) {
          response = { text: '🛒 ¡Tu carrito en DOMIPETS está vacío! Añade productos desde el catálogo.', buttons: [{ id: 'ver_catalogo', title: '🛍️ Ver catálogo' }, { id: 'volver', title: '⬅️ Volver' }] };
        } else {
          const cartTotal = session.cart.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2);
          session.state = STATES.CONFIRM_ORDER;
          await sessionManager.update(phone, session);
          response = {
            text: `📋 Confirma tu pedido en DOMIPETS:\n${session.cart.map(item => `${item.quantity} x ${item.title} - $${(item.price * item.quantity).toFixed(2)}`).join('\n')}\n💰 Total: $${cartTotal} COP\n¿Todo correcto?`,
            buttons: [
              { id: 'confirm_order', title: '✅ Confirmar' },
              { id: 'ver_carrito', title: '🛒 Editar' },
              { id: 'volver', title: '⬅️ Volver' },
            ],
          };
        }
      } else if (processedMessage === 'ver_catalogo') {
        session.state = STATES.VIEW_CATALOG;
        await sessionManager.update(phone, session);
        response = { text: '🛍️ Explora el catálogo de DOMIPETS y elige tus productos:', buttons: [{ id: 'open_catalog', title: '📦 Ver catálogo' }, { id: 'volver', title: '⬅️ Volver' }] };
      } else if (processedMessage === 'volver') {
        session.state = STATES.VIEW_CATALOG;
        await sessionManager.update(phone, session);
        response = { text: '🛍️ Explora el catálogo de DOMIPETS y elige tus productos:', buttons: [{ id: 'open_catalog', title: '📦 Ver catálogo' }, { id: 'volver', title: '⬅️ Volver' }] };
      } else {
        const cartTotal = session.cart.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2);
        response = {
          text: `🛒 Tu carrito en DOMIPETS:\n${session.cart.map(item => `${item.quantity} x ${item.title} - $${(item.price * item.quantity).toFixed(2)}`).join('\n')}\n💰 Total: $${cartTotal}\n¿Confirmas tu pedido?`,
          buttons: BUTTONS.CART,
        };
      }
      await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
    };

    const handleConfirmOrder = async () => {
      if (processedMessage === 'confirm_order') {
        const cartItems = session.cart.map(item => `${item.quantity} x ${item.title} - $${(item.price * item.quantity).toFixed(2)}`).join('\n');
        const total = session.cart.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2);
        const pool = await getPool();
        const result = await pool.query('INSERT INTO orders (phone, items, total, created_at, status) VALUES ($1, $2, $3, $4, $5) RETURNING id', [phone, JSON.stringify(session.cart), total, new Date(), 'pending']);
        const orderId = result.rows[0].id;
        response = {
          text: `🎉 ¡Pedido #${orderId} confirmado en DOMIPETS!\nResumen:\n${cartItems}\n💰 Total: $${total} COP\nEl equipo te contactará para pago y entrega. 🐾`,
          buttons: BUTTONS.MENU,
        };
        session.cart = [];
        session.state = STATES.MENU;
        await sessionManager.update(phone, session);
      } else if (processedMessage === 'ver_carrito') {
        session.state = STATES.VIEW_CART;
        await sessionManager.update(phone, session);
        response = await handleViewCart();
      } else {
        const cartTotal = session.cart.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2);
        response = {
          text: `📋 Confirma tu pedido en DOMIPETS:\n${session.cart.map(item => `${item.quantity} x ${item.title} - $${(item.price * item.quantity).toFixed(2)}`).join('\n')}\n💰 Total: $${cartTotal} COP\n¿Todo correcto?`,
          buttons: [
            { id: 'confirm_order', title: '✅ Confirmar' },
            { id: 'ver_carrito', title: '🛒 Editar' },
            { id: 'volver', title: '⬅️ Volver' },
          ],
        };
      }
      await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
    };

    const handleSupport = async () => {
      if (processedMessage === 'preguntas_frecuentes') {
        const pool = await getPool();
        const faqs = await pool.query('SELECT question, answer FROM faqs LIMIT 5');
        if (faqs.rows.length > 0) {
          const faqList = faqs.rows.map((faq, index) => `${index + 1}. ${faq.question}`).join('\n');
          response = { 
            text: `📚 Preguntas frecuentes de DOMIPETS:\n${faqList}\nEscribe el número de la pregunta para ver la respuesta o "volver" para regresar.`,
            buttons: BUTTONS.SUPPORT
          };
          session.supportAction = 'view_faq';
          session.faqs = faqs.rows;
        } else {
          response = { 
            text: '📚 No hay FAQs disponibles en este momento. ¡Contacta a un asesor! 🐾',
            buttons: BUTTONS.SUPPORT
          };
        }
      } else if (processedMessage === 'contactar_agente') {
        session.supportAction = 'contact_agent';
        response = { text: '💬 Escribe tu consulta y el equipo de DOMIPETS te ayudará pronto. 🐾', buttons: addBackButton([]) };
      } else if (session.supportAction === 'contact_agent') {
        const pool = await getPool();
        await pool.query('INSERT INTO support_requests (phone, message, created_at, status) VALUES ($1, $2, $3, $4)', [phone, userMessage, new Date(), 'pending']);
        
        // Notificación al administrador
        if (process.env.ADMIN_PHONE_NUMBER) {
          await sendWhatsAppMessage(
            process.env.ADMIN_PHONE_NUMBER,
            `🚨 Nueva solicitud de soporte de ${phone}:\n"${userMessage}"\nPor favor, responde pronto.`
          );
        }
        
        response = { 
          text: `✅ Mensaje enviado a DOMIPETS: "${userMessage}". ¡Te contactaremos pronto! 🐾`,
          buttons: BUTTONS.MENU
        };
        session.state = STATES.MENU;
        session.supportAction = null;
      } else if (processedMessage === 'estado_pedido') {
        session.supportAction = 'order_status';
        response = { text: '🚚 Ingresa el número de tu pedido en DOMIPETS:', buttons: addBackButton([]) };
      } else if (session.supportAction === 'order_status') {
        const pool = await getPool();
        const order = await pool.query('SELECT status, total FROM orders WHERE phone = $1 AND id = $2', [phone, processedMessage]);
        response = order.rows.length > 0
          ? { text: `📦 Pedido #${processedMessage} en DOMIPETS: ${order.rows[0].status}. Total: $${order.rows[0].total}.`, buttons: BUTTONS.MENU }
          : { text: '🚚 No encontramos ese pedido. Verifica el número o escribe "volver".', buttons: addBackButton([]) };
        session.state = STATES.MENU;
        session.supportAction = null;
      } else if (session.supportAction === 'view_faq' && !isNaN(parseInt(processedMessage))) {
        const index = parseInt(processedMessage) - 1;
        if (session.faqs && session.faqs[index]) {
          response = { 
            text: `❓ ${session.faqs[index].question}\n${session.faqs[index].answer}\nEscribe otro número o "volver" para regresar.`,
            buttons: addBackButton([])
          };
        } else {
          response = { 
            text: '😿 Número inválido. Elige un número de la lista o escribe "volver".',
            buttons: addBackButton([])
          };
        }
        session.supportAction = 'view_faq';
      } else if (processedMessage === 'volver') {
        session.state = STATES.MENU;
        session.supportAction = null;
        response = { text: '🐾 ¡Volvemos al menú de DOMIPETS! ¿En qué te ayudamos hoy?', buttons: BUTTONS.MENU };
      } else {
        response = { text: '💬 ¿En qué puede ayudarte el equipo de DOMIPETS?', buttons: BUTTONS.SUPPORT };
      }
      await sessionManager.update(phone, session);
      await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
    };

    const handleSearchProducts = async () => {
      if (processedMessage === 'volver') {
        session.state = STATES.MENU;
        response = { text: '🐾 ¡Volvemos al menú de DOMIPETS! ¿En qué te ayudamos hoy?', buttons: BUTTONS.MENU };
      } else {
        const searchTerm = userMessage.trim().toLowerCase();
        const products = await productService.searchProducts(searchTerm, null);
        if (!products.length) {
          response = { 
            text: `😿 No encontramos "${searchTerm}" en DOMIPETS. ¡Intenta otra búsqueda o visita el catálogo! 🛍️`,
            buttons: addBackButton([{ id: 'ver_catalogo', title: '🛍️ Ver catálogo' }])
          };
        } else {
          session.state = STATES.VIEW_CATALOG;
          session.catalog = { offset: 0, searchTerm, products };
          await sessionManager.update(phone, session);
          const visibleProducts = products.slice(0, 3).map((p, index) => `${index + 1}. ${p.title} - $${p.price}`).join('\n');
          response = { 
            text: `🔍 Resultados para "${searchTerm}":\n${visibleProducts}\nEscribe un número (1-3) para seleccionar o "siguiente" para más.`,
            buttons: addBackButton([])
          };
        }
      }
      await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
    };

    const handleReset = async (phone) => {
      await sessionManager.reset(phone);
      return { text: '🔁 ¡Volvamos al inicio en DOMIPETS! ¿Qué quieres para tu mascota hoy? 🐾', buttons: BUTTONS.MENU };
    };

    switch (session.state) {
      case STATES.INIT:
        await handleInit();
        break;
      case STATES.MENU:
        await handleMenu();
        break;
      case STATES.VIEW_CATALOG:
        await handleViewCatalog();
        break;
      case STATES.VIEW_CART:
        await handleViewCart();
        break;
      case STATES.CONFIRM_ORDER:
        await handleConfirmOrder();
        break;
      case STATES.SUPPORT:
        await handleSupport();
        break;
      case STATES.SEARCH_PRODUCTS:
        await handleSearchProducts();
        break;
      default:
        session.state = STATES.INIT;
        await sessionManager.update(phone, session);
        response = { text: '🐾 ¡Bienvenid@ a DOMIPETS! ¿En qué te ayudamos hoy? 😻', buttons: BUTTONS.MENU };
        await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
        break;
    }
  } catch (error) {
    console.error('Error in handleMessage:', error);
    await sendWhatsAppMessage(phone, '😿 ¡Ups! Algo falló en DOMIPETS. Escribe "reiniciar" para empezar de nuevo. 🐾');
    await sessionManager.reset(phone);
  }
};

module.exports = { handleMessage };
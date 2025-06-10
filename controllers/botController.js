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
  SELECT_PRODUCT: 'SELECT_PRODUCT',
  ADD_TO_CART: 'ADD_TO_CART',
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
    { id: 'finalizar_pedido', title: '✅ Finalizar' },
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

const sendWhatsAppMessageWithList = async (to, text, list, buttons = []) => {
  if (!to || !text || !list?.sections || !Array.isArray(list.sections)) {
    throw new Error('Phone number, message text, and valid list sections are required');
  }
  try {
    const payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text },
        action: {
          button: 'Seleccionar',
          sections: list.sections.map(section => ({
            title: section.title.slice(0, 24),
            rows: section.rows.slice(0, 10).map(row => ({
              id: row.id,
              title: row.title.slice(0, 24),
            })),
          })),
        },
      },
    };
    if (buttons.length > 0) {
      payload.interactive.action.buttons = buttons.map(btn => ({
        type: 'reply',
        reply: { id: btn.id, title: btn.title.slice(0, 20) },
      })).slice(0, 3);
    }
    console.log(`List payload sent to ${to}:`, JSON.stringify(payload, null, 2));
    const response = await axios.post(
      `https://graph.facebook.com/v22.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
    console.log(`List message sent to ${to}:`, response.data);
    return response.data;
  } catch (error) {
    console.error('Error sending list message:', error.response?.data || error.message);
    await sendWhatsAppMessage(to, `${text}\n(No se pudo mostrar la lista)`);
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
      !['ver_catalogo', 'buscar_productos', 'hablar_agente', 'estado_pedido', 'ver_carrito', 'finalizar_pedido', 'volver', 'reiniciar', 'next', 'prev', 'qty_1', 'qty_2', 'qty_5', 'confirm_order'].some(id => processedMessage.startsWith(id) || processedMessage === id) &&
      !processedMessage.startsWith('prod_') &&
      !processedMessage.startsWith('animal_') &&
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
        session.catalog.offset = 0;
        await sessionManager.update(phone, session);
        const products = await productService.getCatalogProducts(null, session.catalog.offset);
        if (!products || products.length === 0) {
          response = { text: '😿 ¡No hay productos disponibles en DOMIPETS! Intenta más tarde.', buttons: BUTTONS.MENU };
        } else {
          response = {
            text: '🛍️ Catálogo DOMIPETS:',
            list: {
              sections: [{
                title: 'Todos los productos',
                rows: products.map(p => ({
                  id: `prod_${p.id}`,
                  title: `${p.title.slice(0, 16)} - $${p.price}`.slice(0, 24),
                })),
              }],
            },
            buttons: products.length >= 10 ? [{ id: 'next', title: 'Siguiente' }, ...BUTTONS.CATALOG] : BUTTONS.CATALOG,
          };
        }
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
      await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
    };

    const handleViewCatalog = async () => {
      if (processedMessage === 'next') {
        session.catalog.offset += 10;
        await sessionManager.update(phone, session);
        const products = await productService.getCatalogProducts(null, session.catalog.offset);
        response = {
          text: '🛍️ Catálogo DOMIPETS:',
          list: {
            sections: [{
              title: 'Todos los productos',
              rows: products.map(p => ({
                id: `prod_${p.id}`,
                title: `${p.title.slice(0, 16)} - $${p.price}`.slice(0, 24),
              })),
            }],
          },
          buttons: products.length >= 10
            ? (session.catalog.offset > 0 ? [{ id: 'prev', title: 'Anterior' }, { id: 'next', title: 'Siguiente' }] : [{ id: 'next', title: 'Siguiente' }]).concat(BUTTONS.CATALOG)
            : (session.catalog.offset > 0 ? [{ id: 'prev', title: 'Anterior' }] : []).concat(BUTTONS.CATALOG),
        };
      } else if (processedMessage === 'prev') {
        session.catalog.offset = Math.max(0, session.catalog.offset - 10);
        await sessionManager.update(phone, session);
        const products = await productService.getCatalogProducts(null, session.catalog.offset);
        response = {
          text: '🛍️ Catálogo DOMIPETS:',
          list: {
            sections: [{
              title: 'Todos los productos',
              rows: products.map(p => ({
                id: `prod_${p.id}`,
                title: `${p.title.slice(0, 16)} - $${p.price}`.slice(0, 24),
              })),
            }],
          },
          buttons: products.length >= 10
            ? [{ id: 'prev', title: 'Anterior' }, { id: 'next', title: 'Siguiente' }, ...BUTTONS.CATALOG]
            : (session.catalog.offset > 0 ? [{ id: 'prev', title: 'Anterior' }] : []).concat(BUTTONS.CATALOG),
        };
      } else if (processedMessage.startsWith('prod_')) {
        const productId = processedMessage.replace('prod_', '');
        const product = await productService.getProductById(productId);
        if (!product) {
          response = { text: '😿 ¡Ups! No encontramos ese producto en DOMIPETS. Elige otro o escribe "volver".', buttons: addBackButton([]) };
        } else {
          session.state = STATES.SELECT_PRODUCT;
          session.selectedProduct = product;
          await sessionManager.update(phone, session);
          if (product.image_url) {
            await axios.post(
              `https://graph.facebook.com/v22.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
              {
                messaging_product: 'whatsapp',
                to: phone,
                type: 'image',
                image: { link: product.image_url },
              },
              {
                headers: {
                  Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
                  'Content-Type': 'application/json',
                },
              }
            );
          }
          const stockAlert = product.sizeDetails[0].stock_quantity <= 5 ? '⚠️ ¡Quedan pocas unidades!' : '';
          response = {
            text: `📦 ${product.title} (${product.sizes[0]})\n${product.description}\n💰 Precio: $${product.sizeDetails[0].price}\n${stockAlert}\n¿Cuántas unidades quieres?`,
            buttons: [
              { id: 'qty_1', title: '1' },
              { id: 'qty_2', title: '2' },
              { id: 'qty_5', title: '5' },
              ...addBackButton([]),
            ],
          };
        }
      } else if (processedMessage === 'volver') {
        session.state = STATES.MENU;
        await sessionManager.update(phone, session);
        response = { text: '🐾 ¿En qué te ayudamos hoy en DOMIPETS? 😻', buttons: BUTTONS.MENU };
      } else {
        response = { text: '🛍️ Elige un producto o usa "siguiente/anterior" para navegar.', buttons: addBackButton([]) };
      }
      await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
    };

    const handleSelectProduct = async () => {
      let quantity;
      if (processedMessage === 'qty_1') quantity = 1;
      else if (processedMessage === 'qty_2') quantity = 2;
      else if (processedMessage === 'qty_5') quantity = 5;
      else quantity = parseInt(processedMessage, 10);

      if (!isNaN(quantity) && quantity > 0) {
        const sizeIndex = session.selectedProduct.sizes.indexOf(session.selectedProduct.sizes[0]);
        const stock = session.selectedProduct.sizeDetails[sizeIndex].stock_quantity;
        if (quantity > stock) {
          response = {
            text: `😿 Solo hay ${stock} unidades de ${session.selectedProduct.title} en DOMIPETS. Elige otra cantidad.`,
            buttons: [
              { id: 'qty_1', title: '1' },
              { id: 'qty_2', title: '2' },
              { id: 'qty_5', title: '5' },
              ...addBackButton([]),
            ],
          };
        } else {
          session.cart.push({
            productId: session.selectedProduct.id,
            title: session.selectedProduct.title,
            size: session.selectedProduct.sizes[0],
            quantity,
            price: session.selectedProduct.sizeDetails[sizeIndex].price,
          });
          session.state = STATES.ADD_TO_CART;
          await sessionManager.update(phone, session);
          response = {
            text: `🎉 ¡Añadido ${quantity} x ${session.selectedProduct.title} al carrito de DOMIPETS!\n¿Quieres seguir comprando o ver el carrito?`,
            buttons: BUTTONS.CATALOG,
          };
        }
      } else if (processedMessage === 'volver') {
        session.state = STATES.VIEW_CATALOG;
        await sessionManager.update(phone, session);
        const products = await productService.getCatalogProducts(null, session.catalog.offset);
        response = {
          text: '🛍️ Catálogo DOMIPETS:',
          list: {
            sections: [{
              title: 'Todos los productos',
              rows: products.map(p => ({
                id: `prod_${p.id}`,
                title: `${p.title.slice(0, 16)} - $${p.price}`.slice(0, 24),
              })),
            }],
          },
          buttons: products.length >= 10 ? [{ id: 'next', title: 'Siguiente' }, ...BUTTONS.CATALOG] : BUTTONS.CATALOG,
        };
      } else {
        response = {
          text: '🐾 Ingresa un número (ej. 2) o selecciona una cantidad para tu peludo.',
          buttons: [
            { id: 'qty_1', title: '1' },
            { id: 'qty_2', title: '2' },
            { id: 'qty_5', title: '5' },
            ...addBackButton([]),
          ],
        };
      }
      await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
    };

    const handleAddToCart = async () => {
      if (processedMessage === 'ver_carrito') {
        session.state = STATES.VIEW_CART;
        await sessionManager.update(phone, session);
        response = await handleCartView(phone, session);
      } else if (processedMessage === 'ver_catalogo') {
        session.state = STATES.VIEW_CATALOG;
        session.catalog.offset = 0;
        await sessionManager.update(phone, session);
        const products = await productService.getCatalogProducts(null, session.catalog.offset);
        response = {
          text: '🛍️ Catálogo DOMIPETS:',
          list: {
            sections: [{
              title: 'Todos los productos',
              rows: products.map(p => ({
                id: `prod_${p.id}`,
                title: `${p.title.slice(0, 16)} - $${p.price}`.slice(0, 24),
              })),
            }],
          },
          buttons: products.length >= 10 ? [{ id: 'next', title: 'Siguiente' }, ...BUTTONS.CATALOG] : BUTTONS.CATALOG,
        };
      } else if (processedMessage === 'volver') {
        session.state = STATES.VIEW_CATALOG;
        await sessionManager.update(phone, session);
        const products = await productService.getCatalogProducts(null, session.catalog.offset);
        response = {
          text: '🛍️ Catálogo DOMIPETS:',
          list: {
            sections: [{
              title: 'Todos los productos',
              rows: products.map(p => ({
                id: `prod_${p.id}`,
                title: `${p.title.slice(0, 16)} - $${p.price}`.slice(0, 24),
              })),
            }],
          },
          buttons: products.length >= 10 ? [{ id: 'next', title: 'Siguiente' }, ...BUTTONS.CATALOG] : BUTTONS.CATALOG,
        };
      } else {
        response = { text: '🐾 ¿Quieres ver el carrito o seguir comprando?', buttons: BUTTONS.CATALOG };
      }
      await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
    };

    const handleCartView = async (phone, session) => {
      if (!session.cart || session.cart.length === 0) {
        return { text: '🛒 ¡Tu carrito en DOMIPETS está vacío! 😿 Añade productos para tu peludo.', buttons: addBackButton([{ id: 'ver_catalogo', title: '🛍️ Ver catálogo' }]) };
      }
      const cartItems = session.cart.map(item => `${item.quantity} x ${item.title} (${item.size}) - $${(item.price * item.quantity).toFixed(2)}`).join('\n');
      const total = session.cart.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2);
      const pool = await getPool();
      await pool.query(
        'INSERT INTO user_interactions (phone, action, details, timestamp) VALUES ($1, $2, $3, $4)',
        [phone, 'view_cart', { items: session.cart, total }, new Date()]
      );
      return { text: `🛒 Tu carrito en DOMIPETS:\n${cartItems}\n💰 Total: $${total}\n¿Confirmas tu pedido?`, buttons: BUTTONS.CART };
    };

    const handleViewCart = async () => {
      if (processedMessage === 'finalizar_pedido') {
        if (!session.cart || session.cart.length === 0) {
          response = { text: '🛒 ¡Tu carrito en DOMIPETS está vacío! 😿 Añade productos para tu peludo.', buttons: addBackButton([{ id: 'ver_catalogo', title: '🛍️ Ver catálogo' }]) };
        } else {
          const cartItems = session.cart.map(item => `${item.quantity} x ${item.title} (${item.size}) - $${(item.price * item.quantity).toFixed(2)}`).join('\n');
          const total = session.cart.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2);
          session.state = STATES.CONFIRM_ORDER;
          await sessionManager.update(phone, session);
          response = {
            text: `📋 Confirma tu pedido en DOMIPETS:\n${cartItems}\n💰 Total: $${total} COP\n¿Todo correcto?`,
            buttons: [
              { id: 'confirm_order', title: '✅ Confirmar' },
              { id: 'ver_carrito', title: '🛒 Editar' },
              ...addBackButton([]),
            ],
          };
        }
      } else if (processedMessage === 'confirm_order' && session.state === STATES.CONFIRM_ORDER) {
        const cartItems = session.cart.map(item => `${item.quantity} x ${item.title} (${item.size}) - $${(item.price * item.quantity).toFixed(2)}`).join('\n');
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
      } else if (processedMessage === 'ver_catalogo') {
        session.state = STATES.VIEW_CATALOG;
        session.catalog.offset = 0;
        await sessionManager.update(phone, session);
        const products = await productService.getCatalogProducts(null, session.catalog.offset);
        response = {
          text: '🛍️ Catálogo DOMIPETS:',
          list: {
            sections: [{
              title: 'Todos los productos',
              rows: products.map(p => ({
                id: `prod_${p.id}`,
                title: `${p.title.slice(0, 16)} - $${p.price}`.slice(0, 24),
              })),
            }],
          },
          buttons: products.length >= 10 ? [{ id: 'next', title: 'Siguiente' }, ...BUTTONS.CATALOG] : BUTTONS.CATALOG,
        };
      } else if (processedMessage === 'volver') {
        session.state = STATES.VIEW_CATALOG;
        await sessionManager.update(phone, session);
        const products = await productService.getCatalogProducts(null, session.catalog.offset);
        response = {
          text: '🛍️ Catálogo DOMIPETS:',
          list: {
            sections: [{
              title: 'Todos los productos',
              rows: products.map(p => ({
                id: `prod_${p.id}`,
                title: `${p.title.slice(0, 16)} - $${p.price}`.slice(0, 24),
              })),
            }],
          },
          buttons: products.length >= 10 ? [{ id: 'next', title: 'Siguiente' }, ...BUTTONS.CATALOG] : BUTTONS.CATALOG,
        };
      } else {
        response = await handleCartView(phone, session);
      }
      await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
    };

    const handleSupport = async () => {
      if (processedMessage === 'preguntas_frecuentes') {
        const pool = await getPool();
        const faqs = await pool.query('SELECT question, answer FROM faqs LIMIT 5');
        const faqText = faqs.rows.map(faq => `❓ ${faq.question}\n${faq.answer}`).join('\n\n');
        response = { text: `📚 Preguntas frecuentes de DOMIPETS:\n${faqText || 'No hay FAQs disponibles.'}`, buttons: BUTTONS.SUPPORT };
      } else if (processedMessage === 'contactar_agente') {
        session.supportAction = 'contact_agent';
        response = { text: '💬 Escribe tu consulta y el equipo de DOMIPETS te ayudará pronto. 🐾', buttons: addBackButton([]) };
      } else if (processedMessage === 'estado_pedido') {
        session.supportAction = 'order_status';
        response = { text: '🚚 Ingresa el número de tu pedido en DOMIPETS:', buttons: addBackButton([]) };
      } else if (processedMessage === 'volver') {
        session.state = STATES.MENU;
        session.supportAction = null;
        response = { text: '🐾 ¡Volvemos al menú de DOMIPETS! ¿En qué te ayudamos hoy?', buttons: BUTTONS.MENU };
      } else if (session.supportAction === 'contact_agent') {
        const pool = await getPool();
        await pool.query('INSERT INTO support_requests (phone, message, created_at, status) VALUES ($1, $2, $3, $4)', [phone, userMessage, new Date(), 'pending']);
        response = { text: `✅ Mensaje enviado a DOMIPETS: "${userMessage}". ¡Te contactaremos pronto! 🐾`, buttons: BUTTONS.MENU };
        session.state = STATES.MENU;
        session.supportAction = null;
      } else if (session.supportAction === 'order_status') {
        const pool = await getPool();
        const order = await pool.query('SELECT status, total FROM orders WHERE phone = $1 AND id = $2', [phone, processedMessage]);
        response = order.rows.length > 0
          ? { text: `📦 Pedido #${processedMessage} en DOMIPETS: ${order.rows[0].status}. Total: $${order.rows[0].total}.`, buttons: BUTTONS.MENU }
          : { text: '🚚 No encontramos ese pedido. Verifica el número o escribe "volver".', buttons: addBackButton([]) };
        session.state = STATES.MENU;
        session.supportAction = null;
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
          response = { text: `😿 No encontramos "${searchTerm}" en DOMIPETS. ¡Intenta otra búsqueda!`, buttons: addBackButton([{ id: 'ver_catalogo', title: '🛍️ Ver catálogo' }]) };
        } else {
          session.state = STATES.VIEW_CATALOG;
          session.catalog.offset = 0;
          await sessionManager.update(phone, session);
          response = {
            text: `🛍️ Resultados para "${searchTerm}" en DOMIPETS:`,
            list: {
              sections: [{
                title: 'Productos encontrados',
                rows: products.map(p => ({
                  id: `prod_${p.id}`,
                  title: `${p.title.slice(0, 16)} - $${p.price}`.slice(0, 24),
                })),
              }],
            },
            buttons: products.length >= 10 ? [{ id: 'next', title: 'Siguiente' }, ...BUTTONS.CATALOG] : BUTTONS.CATALOG,
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
      case STATES.SELECT_PRODUCT:
        await handleSelectProduct();
        break;
      case STATES.ADD_TO_CART:
        await handleAddToCart();
        break;
      case STATES.VIEW_CART:
        await handleViewCart();
        break;
      case STATES.CONFIRM_ORDER:
        await handleViewCart();
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
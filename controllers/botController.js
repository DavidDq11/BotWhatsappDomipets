const axios = require('axios');
const productService = require('../services/productService');
const sessionManager = require('../utils/sessionManager');
const { getPool } = require('../config/db');
require('dotenv').config();

if (!process.env.WHATSAPP_PHONE_NUMBER_ID || !process.env.WHATSAPP_ACCESS_TOKEN) {
  throw new Error('WHATSAPP_PHONE_NUMBER_ID y WHATSAPP_ACCESS_TOKEN deben estar definidos en el archivo .env');
}

const STATES = {
  INIT: 'INIT',
  MENU: 'MENU',
  SELECT_PET: 'SELECT_PET',
  SELECT_CATEGORY: 'SELECT_CATEGORY',
  SELECT_PRODUCT: 'SELECT_PRODUCT',
  SELECT_SIZE: 'SELECT_SIZE',
  ADD_TO_CART: 'ADD_TO_CART',
  VIEW_CART: 'VIEW_CART',
  SUPPORT: 'SUPPORT',
  SEARCH_PRODUCTS: 'SEARCH_PRODUCTS',
  CONFIRM_ORDER: 'CONFIRM_ORDER',
};

const BUTTONS = {
  MENU: [
    { id: 'ver_catalogo', title: '🛍️ Ver productos' },
    { id: 'buscar_productos', title: '🔍 Buscar' },
    { id: 'hablar_agente', title: '💬 Ayuda DOMIPETS' },
    { id: 'estado_pedido', title: '🚚 Mi pedido' },
    { id: 'reiniciar', title: '🔁 Reiniciar' },
  ],
  PET_TYPES: [
    { id: 'animal_Dog', title: '🐶 Perro' },
    { id: 'animal_Cat', title: '🐱 Gato' },
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
    console.log(`Message sent to ${to}:`, response.data);
    return response.data;
  } catch (error) {
    console.error('Error sending WhatsApp message:', error.response?.data || error.message);
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
    console.log(`Message with buttons sent to ${to}:`, response.data);
    return response.data;
  } catch (error) {
    console.error('Error sending WhatsApp message with buttons:', error.response?.data || error.message);
    return await sendWhatsAppMessage(to, `${text}\n(No se pudieron mostrar botones)`);
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
      }));
    }
    console.log(`Sending WhatsApp list payload to ${to}:`, JSON.stringify(payload, null, 2));
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
    console.log(`Message with list sent to ${to}:`, response.data);
    return response.data;
  } catch (error) {
    console.error('Error sending WhatsApp message with list:', error.response?.data || error.message);
    return await sendWhatsAppMessage(to, `${text}\n(No se pudo mostrar la lista)`);
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
  session.catalog = session.catalog || { offset: 0, category: null, animal: null };
  session.errorCount = session.errorCount || 0;

  let processedMessage = (userMessage || '').trim().toLowerCase();

  if (interactiveMessage) {
    if (interactiveMessage.type === 'button_reply') {
      processedMessage = interactiveMessage.button_reply.id;
    } else if (interactiveMessage.type === 'list_reply') {
      processedMessage = interactiveMessage.list_reply.id;
    }
  }

  if (!interactiveMessage) {
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
    } else if (processedMessage.includes('perro') || processedMessage.includes('perros')) {
      session.preferredAnimal = 'Dog';
      await sessionManager.update(phone, session);
      processedMessage = 'ver_catalogo';
    } else if (processedMessage.includes('gato') || processedMessage.includes('gatos')) {
      session.preferredAnimal = 'Cat';
      await sessionManager.update(phone, session);
      processedMessage = 'ver_catalogo';
    }
  }

  console.log(`Processing message from ${phone}, state: ${session.state}, message: ${processedMessage}`);

  let response;
  try {
    if (
      processedMessage &&
      !['ver_catalogo', 'buscar_productos', 'hablar_agente', 'estado_pedido', 'ver_carrito', 'finalizar_pedido', 'volver', 'reiniciar', 'next', 'prev', 'qty_1', 'qty_2', 'qty_5'].some(id => processedMessage.startsWith(id) || processedMessage === id) &&
      !processedMessage.startsWith('cat_') &&
      !processedMessage.startsWith('animal_') &&
      !processedMessage.startsWith('prod_') &&
      !processedMessage.startsWith('size_') &&
      isNaN(parseInt(processedMessage))
    ) {
      session.errorCount += 1;
      await sessionManager.update(phone, session);
      if (session.errorCount >= 3) {
        session.state = STATES.MENU;
        session.errorCount = 0;
        response = { text: '😿 ¡Ups! Parece que te perdiste. En DOMIPETS te llevamos al inicio. 🐾 ¿Qué quieres hacer?', buttons: BUTTONS.MENU };
        await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
        await sessionManager.update(phone, session);
        return response;
      }
    } else {
      session.errorCount = 0;
      await sessionManager.update(phone, session);
    }

    const handleInit = async () => {
      session.state = STATES.SELECT_PET;
      response = {
        text: '🐾 ¡Bienvenid@ a DOMIPETS! Somos tu tienda favorita para consentir a tu mejor amigo. 😻 ¿Es para tu perro o gato?',
        buttons: BUTTONS.PET_TYPES,
      };
      await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
      await sessionManager.update(phone, session);
    };

    const handleSelectPet = async () => {
      if (processedMessage.startsWith('animal_')) {
        session.preferredAnimal = processedMessage.replace('animal_', '');
        session.state = STATES.SELECT_CATEGORY;
        await sessionManager.update(phone, session);
        try {
          const categories = await productService.getMainCategories(session.preferredAnimal);
          console.log(`Categories for ${session.preferredAnimal}:`, categories);
          if (!categories.length) {
            response = {
              text: `😿 ¡Vaya! No encontramos categorías para tu ${productService.ANIMAL_CATEGORY_MAP[session.preferredAnimal.toLowerCase()]} en DOMIPETS. ¡Intenta de nuevo o elige otro amigo peludo!`,
              buttons: BUTTONS.PET_TYPES,
            };
            await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
          } else {
            response = {
              text: `🎉 ¡Perfecto! ¿Qué quieres para mimar a tu ${productService.ANIMAL_CATEGORY_MAP[session.preferredAnimal.toLowerCase()]} en DOMIPETS?`,
              list: {
                sections: [{
                  title: 'Categorías',
                  rows: categories.map(cat => ({
                    id: `cat_${cat}`,
                    title: productService.MAIN_CATEGORIES_MAP[cat] || cat,
                  })),
                }],
              },
              buttons: BUTTONS.CATALOG,
            };
            await sendWhatsAppMessageWithList(phone, response.text, response.list, response.buttons);
          }
        } catch (error) {
          console.error(`Error fetching categories for ${session.preferredAnimal}:`, error);
          response = {
            text: '😿 ¡Ups! Algo salió mal al cargar las categorías. En DOMIPETS estamos trabajando en ello. Intenta de nuevo.',
            buttons: BUTTONS.PET_TYPES,
          };
          await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
        }
      } else {
        response = { text: '🐾 En DOMIPETS, queremos saber: ¿es para tu perro o gato?', buttons: BUTTONS.PET_TYPES };
        await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
      }
    };

    const handleSelectCategory = async () => {
      if (processedMessage.startsWith('cat_')) {
        session.catalog.category = processedMessage.replace('cat_', '');
        session.state = STATES.SELECT_PRODUCT;
        session.catalog.offset = 0;
        await sessionManager.update(phone, session);
        const products = await productService.getProducts(session.catalog.category, session.preferredAnimal, null, session.catalog.offset);
        if (!products.length) {
          response = {
            text: `😿 No encontramos productos en ${productService.MAIN_CATEGORIES_MAP[session.catalog.category] || session.catalog.category} para tu ${productService.ANIMAL_CATEGORY_MAP[session.preferredAnimal.toLowerCase()]}. ¡Explora otras categorías en DOMIPETS!`,
            buttons: addBackButton([{ id: 'ver_catalogo', title: '🛍️ Ver categorías' }]),
          };
          await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
        } else {
          response = {
            text: `🛍️ ¡Genial! Aquí tienes productos para tu ${productService.ANIMAL_CATEGORY_MAP[session.preferredAnimal.toLowerCase()]} en ${productService.MAIN_CATEGORIES_MAP[session.catalog.category] || session.catalog.category}. Elige un producto o escribe 'volver' para regresar.`,
            list: {
              sections: [{
                title: 'Productos DOMIPETS',
                rows: products.map(p => {
                  const title = p.title.replace(/ x \d+ (Gms|Kgm|Kgms)/, '').slice(0, 16);
                  const price = `$${Math.round(p.special_price || p.price)}`.slice(0, 7);
                  const stockAlert = p.sizeDetails.some(s => s.stock_quantity <= 5) ? ' ⚠️ ¡Pocas unidades!' : '';
                  return {
                    id: `prod_${p.id}`,
                    title: `${title} ${price}${stockAlert}`.slice(0, 24),
                  };
                }),
              }],
            },
            buttons: products.length >= 10 ? [{ id: 'next', title: 'Siguiente' }, ...BUTTONS.CATALOG] : BUTTONS.CATALOG,
          };
          await sendWhatsAppMessageWithList(phone, response.text, response.list, response.buttons);
        }
      } else if (processedMessage === 'volver') {
        session.state = STATES.SELECT_PET;
        await sessionManager.update(phone, session);
        response = { text: '🐾 En DOMIPETS, queremos saber: ¿es para tu perro o gato?', buttons: BUTTONS.PET_TYPES };
        await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
      } else if (processedMessage === 'ver_carrito') {
        session.state = STATES.VIEW_CART;
        await sessionManager.update(phone, session);
        response = await handleCartView(phone, session);
        await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
      } else if (processedMessage === 'reiniciar') {
        response = await handleReset(phone);
        await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
      } else {
        response = { text: '🐕 Elige una categoría o escribe "volver" para regresar.', buttons: addBackButton([]) };
        await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
      }
    };

    const handleSelectProduct = async () => {
      if (processedMessage === 'next') {
        session.catalog.offset += 10;
        await sessionManager.update(phone, session);
        const products = await productService.getProducts(session.catalog.category, session.preferredAnimal, null, session.catalog.offset);
        response = {
          text: `🛍️ Más productos para tu ${productService.ANIMAL_CATEGORY_MAP[session.preferredAnimal.toLowerCase()]} en ${productService.MAIN_CATEGORIES_MAP[session.catalog.category] || session.catalog.category}:`,
          list: {
            sections: [{
              title: 'Productos DOMIPETS',
              rows: products.map(p => {
                const title = p.title.replace(/ x \d+ (Gms|Kgm|Kgms)/, '').slice(0, 16);
                const price = `$${Math.round(p.special_price || p.price)}`.slice(0, 7);
                const stockAlert = p.sizeDetails.some(s => s.stock_quantity <= 5) ? ' ⚠️ ¡Pocas unidades!' : '';
                return {
                  id: `prod_${p.id}`,
                  title: `${title} ${price}${stockAlert}`.slice(0, 24),
                };
              }),
            }],
          },
          buttons: products.length >= 10
            ? (session.catalog.offset > 0 ? [{ id: 'prev', title: 'Anterior' }, { id: 'next', title: 'Siguiente' }] : [{ id: 'next', title: 'Siguiente' }]).concat(BUTTONS.CATALOG)
            : (session.catalog.offset > 0 ? [{ id: 'prev', title: 'Anterior' }] : []).concat(BUTTONS.CATALOG),
        };
        await sendWhatsAppMessageWithList(phone, response.text, response.list, response.buttons);
      } else if (processedMessage === 'prev') {
        session.catalog.offset = Math.max(0, session.catalog.offset - 10);
        await sessionManager.update(phone, session);
        const products = await productService.getProducts(session.catalog.category, session.preferredAnimal, null, session.catalog.offset);
        response = {
          text: `🛍️ Productos para tu ${productService.ANIMAL_CATEGORY_MAP[session.preferredAnimal.toLowerCase()]} en ${productService.MAIN_CATEGORIES_MAP[session.catalog.category] || session.catalog.category}:`,
          list: {
            sections: [{
              title: 'Productos DOMIPETS',
              rows: products.map(p => {
                const title = p.title.replace(/ x \d+ (Gms|Kgm|Kgms)/, '').slice(0, 16);
                const price = `$${Math.round(p.special_price || p.price)}`.slice(0, 7);
                const stockAlert = p.sizeDetails.some(s => s.stock_quantity <= 5) ? ' ⚠️ ¡Pocas unidades!' : '';
                return {
                  id: `prod_${p.id}`,
                  title: `${title} ${price}${stockAlert}`.slice(0, 24),
                };
              }),
            }],
          },
          buttons: products.length >= 10
            ? [{ id: 'prev', title: 'Anterior' }, { id: 'next', title: 'Siguiente' }, ...BUTTONS.CATALOG]
            : (session.catalog.offset > 0 ? [{ id: 'prev', title: 'Anterior' }] : []).concat(BUTTONS.CATALOG),
        };
        await sendWhatsAppMessageWithList(phone, response.text, response.list, response.buttons);
      } else if (processedMessage.startsWith('prod_')) {
        const productId = parseInt(processedMessage.replace('prod_', ''), 10);
        const product = await productService.getProductById(productId);
        if (!product) {
          response = { text: '😿 ¡Ups! No encontramos ese producto en DOMIPETS. Elige otro o escribe "volver".', buttons: addBackButton([]) };
          await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
        } else {
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
          if (product.sizes.length > 1) {
            session.state = STATES.SELECT_SIZE;
            session.selectedProduct = product;
            await sessionManager.update(phone, session);
            response = {
              text: `📦 ${product.title}\n${product.description}\n💰 Precio: $${product.price}\n${product.sizeDetails.some(s => s.stock_quantity <= 5) ? '⚠️ ¡Quedan pocas unidades!' : ''}\nElige una talla o escribe 'volver':`,
              list: {
                sections: [{
                  title: 'Tallas DOMIPETS',
                  rows: product.sizes.map((s, i) => ({
                    id: `size_${i}`,
                    title: `${s} - $${product.sizeDetails[i].price}${product.sizeDetails[i].stock_quantity <= 5 ? ' ⚠️ ¡Pocas!' : ''}`.slice(0, 24),
                  })),
                }],
              },
              buttons: BUTTONS.CATALOG,
            };
            await sendWhatsAppMessageWithList(phone, response.text, response.list, response.buttons);
          } else {
            session.state = STATES.ADD_TO_CART;
            session.selectedProduct = product;
            session.selectedSize = product.sizes[0] || 'Única';
            await sessionManager.update(phone, session);
            const stockAlert = product.sizeDetails[0]?.stock_quantity <= 5 ? '⚠️ ¡Quedan pocas unidades!' : '';
            response = {
              text: `📦 ${product.title} (${session.selectedSize})\n${product.description}\n💰 Precio: $${product.sizeDetails[0]?.price || product.price}\n${stockAlert}\n¿Cuántas unidades quieres para tu peludo?`,
              buttons: [
                { id: 'qty_1', title: '1' },
                { id: 'qty_2', title: '2' },
                { id: 'qty_5', title: '5' },
                ...addBackButton([]),
              ],
            };
            await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
          }
        }
      } else if (processedMessage === 'volver') {
        session.state = STATES.SELECT_CATEGORY;
        await sessionManager.update(phone, session);
        const categories = await productService.getMainCategories(session.preferredAnimal);
        response = {
          text: `🎉 ¡Perfecto! ¿Qué quieres para mimar a tu ${productService.ANIMAL_CATEGORY_MAP[session.preferredAnimal.toLowerCase()]} en DOMIPETS?`,
          list: {
            sections: [{
              title: 'Categorías',
              rows: categories.map(cat => ({
                id: `cat_${cat}`,
                title: productService.MAIN_CATEGORIES_MAP[cat] || cat,
              })),
            }],
          },
          buttons: BUTTONS.CATALOG,
        };
        await sendWhatsAppMessageWithList(phone, response.text, response.list, response.buttons);
      } else if (processedMessage === 'reiniciar') {
        response = await handleReset(phone);
        await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
      } else {
        response = { text: '🐕 Elige un producto o escribe "volver" para regresar.', buttons: addBackButton([]) };
        await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
      }
    };

    const handleSelectSize = async () => {
      if (processedMessage.startsWith('size_')) {
        const sizeIndex = parseInt(processedMessage.replace('size_', ''), 10);
        if (isNaN(sizeIndex) || sizeIndex >= session.selectedProduct.sizes.length) {
          response = { text: '😿 ¡Talla no válida en DOMIPETS! Elige otra o escribe "volver".', buttons: addBackButton([]) };
          await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
        } else {
          session.selectedSize = session.selectedProduct.sizes[sizeIndex];
          session.state = STATES.ADD_TO_CART;
          await sessionManager.update(phone, session);
          const stockAlert = session.selectedProduct.sizeDetails[sizeIndex].stock_quantity <= 5 ? '⚠️ ¡Quedan pocas unidades!' : '';
          response = {
            text: `📦 ${session.selectedProduct.title} (${session.selectedSize})\n${session.selectedProduct.description}\n💰 Precio: $${session.selectedProduct.sizeDetails[sizeIndex].price}\n${stockAlert}\n¿Cuántas unidades quieres para tu peludo?`,
            buttons: [
              { id: 'qty_1', title: '1' },
              { id: 'qty_2', title: '2' },
              { id: 'qty_5', title: '5' },
              ...addBackButton([]),
            ],
          };
          await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
        }
      } else if (processedMessage === 'volver') {
        session.state = STATES.SELECT_PRODUCT;
        await sessionManager.update(phone, session);
        const products = await productService.getProducts(session.catalog.category, session.preferredAnimal, null, session.catalog.offset);
        response = {
          text: `🛍️ ¡Genial! Aquí tienes productos para tu ${productService.ANIMAL_CATEGORY_MAP[session.preferredAnimal.toLowerCase()]} en ${productService.MAIN_CATEGORIES_MAP[session.catalog.category] || session.catalog.category}. Elige un producto o escribe 'volver' para regresar.`,
          list: {
            sections: [{
              title: 'Productos DOMIPETS',
              rows: products.map(p => {
                const title = p.title.replace(/ x \d+ (Gms|Kgm|Kgms)/, '').slice(0, 16);
                const price = `$${Math.round(p.special_price || p.price)}`.slice(0, 7);
                const stockAlert = p.sizeDetails.some(s => s.stock_quantity <= 5) ? ' ⚠️ ¡Pocas unidades!' : '';
                return {
                  id: `prod_${p.id}`,
                  title: `${title} ${price}${stockAlert}`.slice(0, 24),
                };
              }),
            }],
          },
          buttons: products.length >= 10 ? [{ id: 'next', title: 'Siguiente' }, ...BUTTONS.CATALOG] : BUTTONS.CATALOG,
        };
        await sendWhatsAppMessageWithList(phone, response.text, response.list, response.buttons);
      } else if (processedMessage === 'reiniciar') {
        response = await handleReset(phone);
        await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
      } else {
        response = { text: '🐕 Elige una talla o escribe "volver" para regresar.', buttons: addBackButton([]) };
        await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
      }
    };

    const handleAddToCart = async () => {
      let quantity;
      if (processedMessage === 'qty_1') quantity = 1;
      else if (processedMessage === 'qty_2') quantity = 2;
      else if (processedMessage === 'qty_5') quantity = 5;
      else quantity = parseInt(processedMessage, 10);

      if (!isNaN(quantity) && quantity > 0) {
        const sizeIndex = session.selectedProduct.sizes.indexOf(session.selectedSize);
        const stock = session.selectedProduct.sizeDetails[sizeIndex].stock_quantity;
        if (quantity > stock) {
          response = {
            text: `😿 Solo hay ${stock} unidades de ${session.selectedProduct.title} (${session.selectedSize}) en DOMIPETS. Elige otra cantidad o escribe "volver".`,
            buttons: [
              { id: 'qty_1', title: '1' },
              { id: 'qty_2', title: '2' },
              { id: 'qty_5', title: '5' },
              ...addBackButton([]),
            ],
          };
          await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
        } else {
          session.cart.push({
            productId: session.selectedProduct.id,
            title: session.selectedProduct.title,
            size: session.selectedSize,
            quantity,
            price: session.selectedProduct.sizeDetails[sizeIndex].price,
          });
          session.state = STATES.VIEW_CART;
          await sessionManager.update(phone, session);
          let recommendationText = '';
          let recommendedCategory = 'Accessories';
          if (session.selectedProduct.category === 'Pet Food' || session.selectedProduct.category === 'Wet Food') {
            recommendationText = '¡Mima a tu peludo con un comedero o juguete! 🐾';
            recommendedCategory = 'Accessories';
          } else if (session.selectedProduct.category === 'Litter') {
            recommendationText = '¡Un rascador sería perfecto para tu gato! 😺';
            recommendedCategory = 'Accessories';
          } else if (session.selectedProduct.category === 'Accessories') {
            recommendedCategory = 'Pet Treats';
            recommendationText = '¡Consiente a tu peludo con un snack delicioso! 🍬';
          } else {
            recommendedCategory = 'Pet Treats';
            recommendationText = '¡Mima a tu peludo con un snack! 🍬';
          }
          const recommendedProducts = await productService.getProducts(
            recommendedCategory,
            session.preferredAnimal,
            null,
            0,
            3
          );
          if (recommendedProducts.length) {
            recommendationText += `\nRecomendaciones DOMIPETS:\n${recommendedProducts.map(p => `${p.title} - $${p.price}${p.sizeDetails.some(s => s.stock_quantity <= 5) ? ' ⚠️ ¡Pocas unidades!' : ''}`).join('\n')}`;
          } else {
            recommendationText += `\n😿 No tenemos ${recommendedCategory.toLowerCase()} ahora, pero explora más productos en DOMIPETS.`;
          }
          response = {
            text: `🎉 ¡Añadido ${quantity} x ${session.selectedProduct.title} (${session.selectedSize}) al carrito de DOMIPETS!\n${recommendationText}\n¿Listo para seguir comprando o finalizar?`,
            buttons: BUTTONS.CART,
          };
          await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
        }
      } else if (processedMessage === 'ver_carrito') {
        session.state = STATES.VIEW_CART;
        await sessionManager.update(phone, session);
        response = await handleCartView(phone, session);
        await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
      } else if (processedMessage === 'finalizar_pedido') {
        session.state = STATES.VIEW_CART;
        await sessionManager.update(phone, session);
        response = await handleCartView(phone, session);
        await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
      } else if (processedMessage === 'volver') {
        session.state = STATES.SELECT_PRODUCT;
        await sessionManager.update(phone, session);
        const products = await productService.getProducts(session.catalog.category, session.preferredAnimal, null, session.catalog.offset);
        response = {
          text: `🛍️ ¡Genial! Aquí tienes productos para tu ${productService.ANIMAL_CATEGORY_MAP[session.preferredAnimal.toLowerCase()]} en ${productService.MAIN_CATEGORIES_MAP[session.catalog.category] || session.catalog.category}. Elige un producto o escribe 'volver' para regresar.`,
          list: {
            sections: [{
              title: 'Productos DOMIPETS',
              rows: products.map(p => {
                const title = p.title.replace(/ x \d+ (Gms|Kgm|Kgms)/, '').slice(0, 16);
                const price = `$${Math.round(p.special_price || p.price)}`.slice(0, 7);
                const stockAlert = p.sizeDetails.some(s => s.stock_quantity <= 5) ? ' ⚠️ ¡Pocas unidades!' : '';
                return {
                  id: `prod_${p.id}`,
                  title: `${title} ${price}${stockAlert}`.slice(0, 24),
                };
              }),
            }],
          },
          buttons: products.length >= 10 ? [{ id: 'next', title: 'Siguiente' }, ...BUTTONS.CATALOG] : BUTTONS.CATALOG,
        };
        await sendWhatsAppMessageWithList(phone, response.text, response.list, response.buttons);
      } else if (processedMessage === 'reiniciar') {
        response = await handleReset(phone);
        await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
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
        await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
      }
    };

    const handleCartView = async (phone, session) => {
      if (session.cart.length === 0) {
        return { text: '🛒 ¡Tu carrito en DOMIPETS está vacío! 😿 Añade algo para consentir a tu peludo. 🐶', buttons: addBackButton([{ id: 'ver_catalogo', title: '🛍️ Ver productos' }]) };
      }
      const cartItems = session.cart.map(item => `${item.quantity} x ${item.title} (${item.size}) - $${(item.price * item.quantity).toFixed(2)}`).join('\n');
      const total = session.cart.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2);
      let recommendationText = '';
      const hasFood = session.cart.some(item => ['Pet Food', 'Wet Food'].includes(item.category));
      const hasLitter = session.cart.some(item => item.category === 'Litter');
      const hasAccessories = session.cart.some(item => item.category === 'Accessories');
      let recommendedCategory = 'Pet Treats';
      if (hasFood) {
        recommendationText = '¡Un comedero o juguete sería perfecto para tu peludo! 🐾';
        recommendedCategory = 'Accessories';
      } else if (hasLitter) {
        recommendationText = '¡Un rascador sería ideal para tu gato! 😺';
        recommendedCategory = 'Accessories';
      } else if (hasAccessories) {
        recommendationText = '¡Consiente a tu peludo con un snack delicioso! 🍬';
        recommendedCategory = 'Pet Treats';
      } else {
        recommendationText = '¡Mima a tu peludo con un snack! 🍬';
      }
      const recommendedProducts = await productService.getProducts(
        recommendedCategory,
        session.preferredAnimal,
        null,
        0,
        3
      );
      if (recommendedProducts.length) {
        recommendationText += `\nRecomendaciones DOMIPETS:\n${recommendedProducts.map(p => `${p.title} - $${p.price}${p.sizeDetails.some(s => s.stock_quantity <= 5) ? ' ⚠️ ¡Pocas unidades!' : ''}`).join('\n')}`;
      } else {
        recommendationText += `\n😿 No tenemos ${recommendedCategory.toLowerCase()} ahora, pero explora más productos en DOMIPETS.`;
      }
      const pool = await getPool();
      await pool.query(
        'INSERT INTO user_interactions (phone, action, details, timestamp) VALUES ($1, $2, $3, $4)',
        [phone, 'view_cart', { items: session.cart, total }, new Date()]
      );
      return { text: `🛒 Tu carrito en DOMIPETS:\n${cartItems}\n💰 Total: $${total}\n${recommendationText}\n¿Todo listo para confirmar? 🎉`, buttons: BUTTONS.CART };
    };

    const handleViewCart = async () => {
      if (processedMessage === 'finalizar_pedido') {
        if (session.cart.length === 0) {
          response = { text: '🛒 ¡Tu carrito en DOMIPETS está vacío! 😿 Añade algo para consentir a tu peludo. 🐶', buttons: addBackButton([{ id: 'ver_catalogo', title: '🛍️ Ver productos' }]) };
        } else {
          const cartItems = session.cart.map(item => `${item.quantity} x ${item.title} (${item.size}) - $${(item.price * item.quantity).toFixed(2)}`).join('\n');
          const total = session.cart.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2);
          session.state = STATES.CONFIRM_ORDER;
          await sessionManager.update(phone, session);
          response = {
            text: `📋 Revisa tu pedido en DOMIPETS:\n${cartItems}\n💰 Total: $${total} COP\n¿Todo correcto para tu peludo? 🎉`,
            buttons: [
              { id: 'confirm_order', title: '✅ Confirmar' },
              { id: 'ver_carrito', title: '🛒 Editar carrito' },
              ...addBackButton([]),
            ],
          };
        }
      } else if (processedMessage === 'confirm_order' && session.state === STATES.CONFIRM_ORDER) {
        const cartItems = session.cart.map(item => `${item.quantity} x ${item.title} (${item.size}) - $${(item.price * item.quantity).toFixed(2)}`).join('\n');
        const total = session.cart.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2);
        const pool = await getPool();
        await pool.query(
          'INSERT INTO orders (phone, items, total, created_at, status) VALUES ($1, $2, $3, $4, $5)',
          [phone, JSON.stringify(session.cart), total, new Date(), 'pending']
        );
        response = {
          text: `🎉 ¡Pedido confirmado en DOMIPETS!\nResumen:\n${cartItems}\n💰 Total: $${total} COP\nEl equipo de DOMIPETS te contactará pronto para coordinar pago y entrega. 🐾`,
          buttons: BUTTONS.MENU,
        };
        session.cart = [];
        session.state = STATES.MENU;
        await sessionManager.update(phone, session);
      } else if (processedMessage === 'ver_catalogo') {
        session.state = STATES.SELECT_CATEGORY;
        await sessionManager.update(phone, session);
        const categories = await productService.getMainCategories(session.preferredAnimal);
        response = {
          text: `🎉 ¡Perfecto! ¿Qué quieres para mimar a tu ${productService.ANIMAL_CATEGORY_MAP[session.preferredAnimal.toLowerCase()]} en DOMIPETS?`,
          list: {
            sections: [{
              title: 'Categorías',
              rows: categories.map(cat => ({
                id: `cat_${cat}`,
                title: productService.MAIN_CATEGORIES_MAP[cat] || cat,
              })),
            }],
          },
          buttons: BUTTONS.CATALOG,
        };
        await sendWhatsAppMessageWithList(phone, response.text, response.list, response.buttons);
      } else if (processedMessage === 'volver') {
        session.state = STATES.SELECT_CATEGORY;
        await sessionManager.update(phone, session);
        const categories = await productService.getMainCategories(session.preferredAnimal);
        response = {
          text: `🎉 ¡Perfecto! ¿Qué quieres para mimar a tu ${productService.ANIMAL_CATEGORY_MAP[session.preferredAnimal.toLowerCase()]} en DOMIPETS?`,
          list: {
            sections: [{
              title: 'Categorías',
              rows: categories.map(cat => ({
                id: `cat_${cat}`,
                title: productService.MAIN_CATEGORIES_MAP[cat] || cat,
              })),
            }],
          },
          buttons: BUTTONS.CATALOG,
        };
        await sendWhatsAppMessageWithList(phone, response.text, response.list, response.buttons);
      } else if (processedMessage === 'reiniciar') {
        response = await handleReset(phone);
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
      } else if (processedMessage === 'reiniciar') {
        response = await handleReset(phone);
      } else if (session.supportAction === 'contact_agent') {
        const pool = await getPool();
        await pool.query('INSERT INTO support_requests (phone, message, created_at, status) VALUES ($1, $2, $3, $4)', [phone, userMessage, new Date(), 'pending']);
        response = { text: `✅ Mensaje enviado a DOMIPETS: "${userMessage}". ¡El equipo de DOMIPETS te contactará pronto! 🐾`, buttons: BUTTONS.MENU };
        session.state = STATES.MENU;
        session.supportAction = null;
      } else if (session.supportAction === 'order_status') {
        const pool = await getPool();
        const order = await pool.query('SELECT status, total FROM orders WHERE phone = $1 AND id = $2', [phone, processedMessage]);
        response = order.rows.length > 0
          ? { text: `📦 Pedido #${processedMessage} en DOMIPETS: ${order.rows[0].status}. Total: $${order.rows[0].total}.`, buttons: BUTTONS.MENU }
          : { text: '🚚 No encontramos ese pedido en DOMIPETS. Verifica el número o escribe "volver".', buttons: addBackButton([]) };
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
      } else if (processedMessage === 'reiniciar') {
        response = await handleReset(phone);
      } else {
        const searchTerm = userMessage.trim().toLowerCase();
        const products = await productService.searchProducts(searchTerm, session.preferredAnimal);
        if (!products.length) {
          response = { text: `😿 No encontramos "${searchTerm}" en DOMIPETS. ¡Intenta otra búsqueda o explora nuestro catálogo!`, buttons: addBackButton([{ id: 'ver_catalogo', title: '🛍️ Ver productos' }]) };
        } else {
          session.state = STATES.SELECT_PRODUCT;
          session.catalog.offset = 0;
          await sessionManager.update(phone, session);
          response = {
            text: `🛍️ Resultados para "${searchTerm}" en DOMIPETS:`,
            list: {
              sections: [{
                title: 'Productos DOMIPETS',
                rows: products.map(p => {
                  const title = p.title.replace(/ x \d+ (Gms|Kgm|Kgms)/, '').slice(0, 16);
                  const price = `$${Math.round(p.special_price || p.price)}`.slice(0, 7);
                  const stockAlert = p.sizeDetails.some(s => s.stock_quantity <= 5) ? ' ⚠️ ¡Pocas unidades!' : '';
                  return {
                    id: `prod_${p.id}`,
                    title: `${title} ${price}${stockAlert}`.slice(0, 24),
                  };
                }),
              }],
            },
            buttons: products.length >= 10 ? [{ id: 'next', title: 'Siguiente' }, ...BUTTONS.CATALOG] : BUTTONS.CATALOG,
          };
          await sendWhatsAppMessageWithList(phone, response.text, response.list, response.buttons);
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
      case STATES.SELECT_PET:
        await handleSelectPet();
        break;
      case STATES.SELECT_CATEGORY:
        await handleSelectCategory();
        break;
      case STATES.SELECT_PRODUCT:
        await handleSelectProduct();
        break;
      case STATES.SELECT_SIZE:
        await handleSelectSize();
        break;
      case STATES.ADD_TO_CART:
        await handleAddToCart();
        break;
      case STATES.VIEW_CART:
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
        response = { text: '🐾 ¡Bienvenid@ a DOMIPETS! Somos tu tienda favorita para consentir a tu mejor amigo. 😻 ¿En qué te ayudamos hoy?', buttons: BUTTONS.MENU };
        await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
        break;
    }
  } catch (error) {
    console.error('Error in handleMessage:', error);
    await sendWhatsAppMessage(phone, '😿 ¡Ups! Algo salió mal en DOMIPETS. Escribe "reiniciar" para empezar de nuevo. 🐾');
    await sessionManager.reset(phone);
  }
};

module.exports = { handleMessage };
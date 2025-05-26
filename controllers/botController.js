// controllers/botController.js
const axios = require('axios');
const productService = require('../services/productService');
const sessionManager = require('../utils/sessionManager');
require('dotenv').config();

if (!process.env.WHATSAPP_PHONE_NUMBER_ID || !process.env.WHATSAPP_ACCESS_TOKEN) {
  throw new Error('WHATSAPP_PHONE_NUMBER_ID y WHATSAPP_ACCESS_TOKEN deben estar definidos en el archivo .env');
}

const STATES = {
  INIT: 'INIT',
  MENU: 'MENU',
  SELECT_MAIN_CATEGORY: 'SELECT_MAIN_CATEGORY',
  SELECT_ANIMAL_BY_MAIN_CATEGORY: 'SELECT_ANIMAL_BY_MAIN_CATEGORY',
  SELECT_PRODUCT_SUBTYPE: 'SELECT_PRODUCT_SUBTYPE',
  SELECT_PRODUCT: 'SELECT_PRODUCT',
  SELECT_SIZE: 'SELECT_SIZE',
  ADD_TO_CART: 'ADD_TO_CART',
  VIEW_CART: 'VIEW_CART',
  SOPORTE: 'SOPORTE',
};

const BUTTONS = {
  MENU: [
    { id: 'ver_catalogo', title: '🛍️ Ver productos' },
    { id: 'hablar_agente', title: '💬 Ayuda de un asesor' },
    { id: 'estado_pedido', title: '🚚 Ver mi pedido' },
    { id: 'reiniciar', title: '🔁 Reiniciar' },
  ],
  CATALOG: [{ id: 'volver', title: '⬅️ Volver' }, { id: 'reiniciar', title: '🔁 Reiniciar' }],
  CART: [
    { id: 'ver_carrito', title: '🛒 Ver carrito' },
    { id: 'finalizar_pedido', title: '✅ Finalizar pedido' },
    { id: 'volver', title: '⬅️ Volver' },
    { id: 'reiniciar', title: '🔁 Reiniciar' },
  ],
  SUPPORT: [
    { id: 'preguntas_frecuentes', title: '❓ Preguntas frecuentes' },
    { id: 'contactar_agente', title: '📞 Contactar asesor' },
    { id: 'volver', title: '⬅️ Volver' },
    { id: 'reiniciar', title: '🔁 Reiniciar' },
  ],
  BACK: { id: 'volver', title: '⬅️ Volver' },
  RESTART: { id: 'reiniciar', title: '🔁 Reiniciar' },
};

const addBackButton = (buttons) => [...(buttons || []), BUTTONS.BACK, BUTTONS.RESTART];

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

const INACTIVITY_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutos en milisegundos

const handleMessage = async (userMessage, phone, interactiveMessage) => {
    if (!phone) throw new Error('Phone number is required');

    let session = await sessionManager.get(phone);

    const now = new Date();
    const lastActivityTime = session.lastActivity instanceof Date ? session.lastActivity.getTime() : new Date(session.lastActivity).getTime();

    if (now.getTime() - lastActivityTime > INACTIVITY_THRESHOLD_MS && session.state !== STATES.INIT) {
        console.log(`Session for ${phone} is inactive. Resetting conversation.`);
        await sessionManager.reset(phone);
        session = await sessionManager.get(phone);

        await sendWhatsAppMessageWithButtons(
            phone,
            '👋 Parece que no hablamos desde hace un rato. ¡No te preocupes! Hemos reiniciado la conversación para que empieces fresco. ¿En qué puedo ayudarte hoy? 🐾',
            BUTTONS.MENU
        );
        return;
    }

    session.cart = session.cart || [];
    session.catalog = session.catalog || { offset: 0, mainCategory: null, animal: null, productSubtype: null };
    session.errorCount = session.errorCount || 0;

    let processedMessage = (userMessage || '').trim().toLowerCase();

    if (interactiveMessage) {
        if (interactiveMessage.type === 'button_reply') {
            processedMessage = interactiveMessage.button_reply.id;
        } else if (interactiveMessage.type === 'list_reply') {
            processedMessage = interactiveMessage.list_reply.id;
        }
    }

    // *** MODIFICACIÓN CLAVE: Eliminar la lógica global de ver_carrito y finalizar_pedido aquí. ***
    // Estas lógicas ahora se manejarán DENTRO de los estados relevantes del switch
    // para asegurar que el estado de la sesión ya esté correcto.

    // Fallback inteligente para palabras clave (ajustado para no interferir con los IDs de botones)
    // Asegúrate de que los IDs de botones interactivos sean prioritarios.
    // Solo si no es un ID de botón, intenta el "fallback inteligente".
    if (!interactiveMessage) { // Solo aplica el fallback si no es un botón interactivo
        if (processedMessage.includes('catalogo') || processedMessage.includes('productos')) {
            processedMessage = 'ver_catalogo';
        } else if (processedMessage.includes('ayuda') || processedMessage.includes('asesor')) {
            processedMessage = 'hablar_agente';
        } else if (processedMessage.includes('pedido') || processedMessage.includes('estado') && processedMessage !== 'estado_pedido') {
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
        // Validación de errores y reinicio
        if (processedMessage && !['ver_catalogo', 'hablar_agente', 'estado_pedido', 'ver_carrito', 'finalizar_pedido', 'volver', 'reiniciar', 'next', 'prev'].some(id => processedMessage.startsWith(id) || processedMessage === id) && !processedMessage.startsWith('maincat_') && !processedMessage.startsWith('animal_') && !processedMessage.startsWith('subtype_') && !processedMessage.startsWith('prod_') && !processedMessage.startsWith('size_') && isNaN(parseInt(processedMessage))) {
            session.errorCount += 1;
            await sessionManager.update(phone, session);
            if (session.errorCount >= 3) {
                session.state = STATES.MENU;
                session.errorCount = 0;
                response = { text: '🐶 ¡Vaya! Parece que te perdiste en el parque 🐾. ¿Volvemos al inicio? Toca una opción para continuar.', buttons: BUTTONS.MENU };
                await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
                await sessionManager.update(phone, session);
                return response;
            }
        } else {
            if (session.errorCount > 0) {
                session.errorCount = 0;
                await sessionManager.update(phone, session);
            }
        }

        switch (session.state) {
            case STATES.INIT:
                session.state = STATES.MENU;
                response = {
                    text: '¡Hola, amigo de las mascotas! 🐾 Bienvenido a *Domipets* 🐕🐱\nAquí tenemos todo lo que tu peludo necesita. ¿Qué quieres explorar hoy?',
                    buttons: BUTTONS.MENU,
                };
                await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
                await sessionManager.update(phone, session);
                break;

            case STATES.MENU:
                if (processedMessage === 'ver_catalogo') {
                    session.state = STATES.SELECT_MAIN_CATEGORY;
                    await sessionManager.update(phone, session);

                    const mainCategoriesDB = await productService.getMainCategories();
                    if (!mainCategoriesDB || mainCategoriesDB.length === 0) {
                        response = { text: '🐾 ¡Ups! No encontramos categorías principales de productos ahora. Intenta de nuevo más tarde.', buttons: addBackButton([]) };
                        await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
                    } else {
                        response = {
                            text: '🛍️ ¿Qué tipo de productos te gustaría ver hoy?',
                            list: {
                                sections: [{
                                    title: 'Categorías Principales',
                                    rows: mainCategoriesDB.map((cat) => ({
                                        id: `maincat_${cat}`,
                                        title: productService.MAIN_CATEGORIES_MAP[cat] || cat
                                    })),
                                }],
                            },
                            buttons: BUTTONS.CATALOG,
                        };
                        await sendWhatsAppMessageWithList(phone, response.text, response.list, response.buttons);
                    }
                } else if (processedMessage === 'hablar_agente') {
                    session.state = STATES.SOPORTE;
                    session.supportAction = 'contact_agent';
                    await sessionManager.update(phone, session);
                    response = { text: '💬 ¡Perfecto! Un asesor te ayudará en un momento. ¿Qué necesitas? Escribe o toca "⬅️ Volver".', buttons: addBackButton([]) };
                    await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
                } else if (processedMessage === 'estado_pedido') {
                    session.state = STATES.SOPORTE;
                    session.supportAction = 'order_status';
                    await sessionManager.update(phone, session);
                    response = { text: '🚚 Por favor, dime el número de tu pedido o toca "⬅️ Volver".', buttons: addBackButton([]) };
                    await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
                } else if (processedMessage === 'reiniciar') {
                    await sessionManager.reset(phone);
                    response = { text: '🔁 ¡Volvamos al inicio, amigo! ¿Qué quieres para tu mascota hoy?', buttons: BUTTONS.MENU };
                    await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
                } else {
                    response = { text: '🐕 ¡Guau! No entendí eso. Toca una opción para seguir explorando 🐾', buttons: BUTTONS.MENU };
                    await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
                }
                break;

            case STATES.SELECT_MAIN_CATEGORY:
                if (processedMessage.startsWith('maincat_')) {
                    const mainCategoryFromButton = processedMessage.replace('maincat_', '');
                    const mainCategoriesDB = await productService.getMainCategories();

                    if (!mainCategoriesDB.includes(mainCategoryFromButton)) {
                        response = { text: '🐾 ¡Ups! Esa no es una categoría principal válida. Elige una o escribe "volver".', buttons: addBackButton([]) };
                        await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
                    } else {
                        session.catalog.mainCategory = mainCategoryFromButton;
                        session.catalog.animal = null;
                        session.catalog.productSubtype = null;

                        const animalsDB = await productService.getAnimalsByMainCategory(session.catalog.mainCategory);

                        if (!animalsDB || animalsDB.length === 0) {
                            session.state = STATES.SELECT_PRODUCT;
                            await sessionManager.update(phone, session);
                            const products = await productService.getProducts(session.catalog.mainCategory, null, null, session.catalog.offset);
                            if (!products || products.length === 0) {
                                response = { text: `🐾 No hay productos en la categoría "${productService.MAIN_CATEGORIES_MAP[session.catalog.mainCategory] || session.catalog.mainCategory}" ahora.`, buttons: addBackButton([]) };
                                await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
                            } else {
                                response = {
                                    text: `🛍️ Productos en "${productService.MAIN_CATEGORIES_MAP[session.catalog.mainCategory] || session.catalog.mainCategory}":\nToca un producto o escribe "volver".`,
                                    list: {
                                        sections: [{
                                            title: productService.MAIN_CATEGORIES_MAP[session.catalog.mainCategory] || session.catalog.mainCategory,
                                            rows: products.map(p => ({
                                                id: `prod_${p.id}`,
                                                title: `${p.title} - $${p.special_price || p.price}`,
                                            })),
                                        }],
                                    },
                                    buttons: products.length >= 10 ? [{ id: 'next', title: 'Siguiente' }, ...BUTTONS.CATALOG] : BUTTONS.CATALOG,
                                };
                                await sendWhatsAppMessageWithList(phone, response.text, response.list, response.buttons);
                            }
                        } else {
                            session.state = STATES.SELECT_ANIMAL_BY_MAIN_CATEGORY;
                            await sessionManager.update(phone, session);
                            response = {
                                text: `🐶 ¿Para qué animal buscas productos en "${productService.MAIN_CATEGORIES_MAP[session.catalog.mainCategory] || session.catalog.mainCategory}"?`,
                                list: {
                                    sections: [{
                                        title: 'Animales',
                                        rows: animalsDB.map((animal) => ({
                                            id: `animal_${animal}`,
                                            title: productService.ANIMAL_CATEGORY_MAP[animal] || animal
                                        })),
                                    }],
                                },
                                buttons: BUTTONS.CATALOG,
                            };
                            await sendWhatsAppMessageWithList(phone, response.text, response.list, response.buttons);
                        }
                    }
                } else if (processedMessage === 'volver') {
                    session.state = STATES.MENU;
                    await sessionManager.update(phone, session);
                    response = { text: '🐾 Volviendo al menú principal...', buttons: BUTTONS.MENU };
                    await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
                } else if (processedMessage === 'reiniciar') {
                    await sessionManager.reset(phone);
                    response = { text: '🔁 ¡Volvamos al inicio, amigo! ¿Qué quieres para tu mascota hoy?', buttons: BUTTONS.MENU };
                    await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
                } else {
                    response = { text: '🐕 ¡Guau! Elige una categoría principal o escribe "volver".', buttons: addBackButton([]) };
                    await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
                }
                break;

            case STATES.SELECT_ANIMAL_BY_MAIN_CATEGORY:
                if (processedMessage.startsWith('animal_')) {
                    const animalFromButton = processedMessage.replace('animal_', '');
                    const animalsDB = await productService.getAnimalsByMainCategory(session.catalog.mainCategory);

                    if (!animalsDB.includes(animalFromButton)) {
                        response = { text: '🐾 ¡Ups! Ese no es un animal válido para esta categoría. Elige uno o escribe "volver".', buttons: addBackButton([]) };
                        await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
                    } else {
                        session.catalog.animal = animalFromButton;
                        session.catalog.productSubtype = null;

                        const subtypesDB = await productService.getProductSubtypes(session.catalog.mainCategory, session.catalog.animal);

                        if (!subtypesDB || subtypesDB.length === 0) {
                            session.state = STATES.SELECT_PRODUCT;
                            await sessionManager.update(phone, session);
                            const products = await productService.getProducts(session.catalog.mainCategory, session.catalog.animal, null, session.catalog.offset);
                            if (!products || products.length === 0) {
                                response = { text: `🐾 No hay productos para ${productService.ANIMAL_CATEGORY_MAP[session.catalog.animal] || session.catalog.animal} en esta categoría.`, buttons: addBackButton([]) };
                                await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
                            } else {
                                response = {
                                    text: `🛍️ Productos para ${productService.ANIMAL_CATEGORY_MAP[session.catalog.animal] || session.catalog.animal} en "${productService.MAIN_CATEGORIES_MAP[session.catalog.mainCategory] || session.catalog.mainCategory}":\nToca un producto o escribe "volver".`,
                                    list: {
                                        sections: [{
                                            title: productService.ANIMAL_CATEGORY_MAP[session.catalog.animal] || session.catalog.animal,
                                            rows: products.map(p => ({
                                                id: `prod_${p.id}`,
                                                title: `${p.title} - $${p.special_price || p.price}`,
                                            })),
                                        }],
                                    },
                                    buttons: products.length >= 10 ? [{ id: 'next', title: 'Siguiente' }, ...BUTTONS.CATALOG] : BUTTONS.CATALOG,
                                };
                                await sendWhatsAppMessageWithList(phone, response.text, response.list, response.buttons);
                            }
                        } else {
                            session.state = STATES.SELECT_PRODUCT_SUBTYPE;
                            await sessionManager.update(phone, session);
                            response = {
                                text: `📦 ¿Qué tipo específico de producto buscas para ${productService.ANIMAL_CATEGORY_MAP[session.catalog.animal] || session.catalog.animal}?`,
                                list: {
                                    sections: [{
                                        title: 'Tipos de Producto',
                                        rows: subtypesDB.map((subtype) => ({
                                            id: `subtype_${subtype}`,
                                            title: productService.PRODUCT_TYPE_MAP[subtype] || subtype
                                        })),
                                    }],
                                },
                                buttons: BUTTONS.CATALOG,
                            };
                            await sendWhatsAppMessageWithList(phone, response.text, response.list, response.buttons);
                        }
                    }
                } else if (processedMessage === 'volver') {
                    session.state = STATES.SELECT_MAIN_CATEGORY;
                    await sessionManager.update(phone, session);
                    const mainCategoriesDB = await productService.getMainCategories();
                    response = {
                        text: '🛍️ ¿Qué tipo de productos te gustaría ver hoy?',
                        list: {
                            sections: [{
                                title: 'Categorías Principales',
                                rows: mainCategoriesDB.map((cat) => ({
                                    id: `maincat_${cat}`,
                                    title: productService.MAIN_CATEGORIES_MAP[cat] || cat
                                })),
                            }],
                        },
                        buttons: BUTTONS.CATALOG,
                    };
                    await sendWhatsAppMessageWithList(phone, response.text, response.list, response.buttons);
                } else if (processedMessage === 'reiniciar') {
                    await sessionManager.reset(phone);
                    response = { text: '🔁 ¡Volvamos al inicio, amigo! ¿Qué quieres para tu mascota hoy?', buttons: BUTTONS.MENU };
                    await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
                } else {
                    response = { text: '🐕 ¡Guau! Elige un animal o escribe "volver".', buttons: addBackButton([]) };
                    await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
                }
                break;

            case STATES.SELECT_PRODUCT_SUBTYPE:
                if (processedMessage.startsWith('subtype_')) {
                    const productSubtypeFromButton = processedMessage.replace('subtype_', '');
                    const subtypesDB = await productService.getProductSubtypes(session.catalog.mainCategory, session.catalog.animal);

                    if (!subtypesDB.includes(productSubtypeFromButton)) {
                        response = { text: '🐾 ¡Ups! Ese tipo de producto no es válido. Elige uno o escribe "volver".', buttons: addBackButton([]) };
                        await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
                    } else {
                        session.catalog.productSubtype = productSubtypeFromButton;
                        session.state = STATES.SELECT_PRODUCT;
                        session.catalog.offset = 0;
                        await sessionManager.update(phone, session);

                        const products = await productService.getProducts(session.catalog.mainCategory, session.catalog.animal, session.catalog.productSubtype, session.catalog.offset);
                        if (!products || products.length === 0) {
                            response = { text: `🐾 No hay ${productService.PRODUCT_TYPE_MAP[session.catalog.productSubtype] || session.catalog.productSubtype} para ${productService.ANIMAL_CATEGORY_MAP[session.catalog.animal] || session.catalog.animal} ahora.`, buttons: addBackButton([]) };
                            await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
                        } else {
                            response = {
                                text: `🛍️ ${productService.PRODUCT_TYPE_MAP[session.catalog.productSubtype] || session.catalog.productSubtype} para ${productService.ANIMAL_CATEGORY_MAP[session.catalog.animal] || session.catalog.animal}:\nToca un producto o escribe "volver".`,
                                list: {
                                    sections: [{
                                        title: productService.PRODUCT_TYPE_MAP[session.catalog.productSubtype] || session.catalog.productSubtype,
                                        rows: products.map(p => ({
                                            id: `prod_${p.id}`,
                                            title: `${p.title} - $${p.special_price || p.price}`,
                                        })),
                                    }],
                                },
                                buttons: products.length >= 10 ? [{ id: 'next', title: 'Siguiente' }, ...BUTTONS.CATALOG] : BUTTONS.CATALOG,
                            };
                            await sendWhatsAppMessageWithList(phone, response.text, response.list, response.buttons);
                        }
                    }
                } else if (processedMessage === 'volver') {
                    session.state = STATES.SELECT_ANIMAL_BY_MAIN_CATEGORY;
                    await sessionManager.update(phone, session);
                    const animalsDB = await productService.getAnimalsByMainCategory(session.catalog.mainCategory);
                    response = {
                        text: `🐶 ¿Para qué animal buscas productos en "${productService.MAIN_CATEGORIES_MAP[session.catalog.mainCategory] || session.catalog.mainCategory}"?`,
                        list: {
                            sections: [{
                                title: 'Animales',
                                rows: animalsDB.map((animal) => ({
                                    id: `animal_${animal}`,
                                    title: productService.ANIMAL_CATEGORY_MAP[animal] || animal
                                })),
                            }],
                        },
                        buttons: BUTTONS.CATALOG,
                    };
                    await sendWhatsAppMessageWithList(phone, response.text, response.list, response.buttons);
                } else if (processedMessage === 'reiniciar') {
                    await sessionManager.reset(phone);
                    response = { text: '🔁 ¡Volvamos al inicio, amigo! ¿Qué quieres para tu mascota hoy?', buttons: BUTTONS.MENU };
                    await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
                } else {
                    response = { text: '🐕 ¡Guau! Elige un tipo de producto o escribe "volver".', buttons: addBackButton([]) };
                    await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
                }
                break;

            case STATES.SELECT_PRODUCT:
                if (processedMessage === 'next') {
                    session.catalog.offset += 10;
                    await sessionManager.update(phone, session);
                    const products = await productService.getProducts(session.catalog.mainCategory, session.catalog.animal, session.catalog.productSubtype, session.catalog.offset);
                    response = {
                        text: `🛍️ Más productos en "${productService.MAIN_CATEGORIES_MAP[session.catalog.mainCategory] || session.catalog.mainCategory}" ${session.catalog.animal ? `para ${productService.ANIMAL_CATEGORY_MAP[session.catalog.animal] || session.catalog.animal}` : ''} ${session.catalog.productSubtype ? `(${productService.PRODUCT_TYPE_MAP[session.catalog.productSubtype] || session.catalog.productSubtype})` : ''}:\nToca un producto o escribe "volver".`,
                        list: {
                            sections: [{
                                title: 'Productos',
                                rows: products.map(p => ({
                                    id: `prod_${p.id}`,
                                    title: `${p.title} - $${p.special_price || p.price}`,
                                })),
                            }],
                        },
                        buttons: products.length >= 10
                            ? (session.catalog.offset > 0 ? [{ id: 'prev', title: 'Anterior' }, { id: 'next', title: 'Siguiente' }] : [{ id: 'next', title: 'Siguiente' }]).concat(BUTTONS.CATALOG)
                            : (session.catalog.offset > 0 ? [{ id: 'prev', title: 'Anterior' }] : []).concat(BUTTONS.CATALOG)
                    };
                    await sendWhatsAppMessageWithList(phone, response.text, response.list, response.buttons);
                } else if (processedMessage === 'prev') {
                    session.catalog.offset = Math.max(0, session.catalog.offset - 10);
                    await sessionManager.update(phone, session);
                    const products = await productService.getProducts(session.catalog.mainCategory, session.catalog.animal, session.catalog.productSubtype, session.catalog.offset);
                    response = {
                        text: `🛍️ Productos en "${productService.MAIN_CATEGORIES_MAP[session.catalog.mainCategory] || session.catalog.mainCategory}" ${session.catalog.animal ? `para ${productService.ANIMAL_CATEGORY_MAP[session.catalog.animal] || session.catalog.animal}` : ''} ${session.catalog.productSubtype ? `(${productService.PRODUCT_TYPE_MAP[session.catalog.productSubtype] || session.catalog.productSubtype})` : ''}:\nToca un producto o escribe "volver".`,
                        list: {
                            sections: [{
                                title: 'Productos',
                                rows: products.map(p => ({
                                    id: `prod_${p.id}`,
                                    title: `${p.title} - $${p.special_price || p.price}`,
                                })),
                            }],
                        },
                        buttons: session.catalog.offset > 0
                            ? (products.length >= 10 ? [{ id: 'prev', title: 'Anterior' }, { id: 'next', title: 'Siguiente' }] : [{ id: 'prev', title: 'Anterior' }]).concat(BUTTONS.CATALOG)
                            : (products.length >= 10 ? [{ id: 'next', title: 'Siguiente' }] : []).concat(BUTTONS.CATALOG)
                    };
                    await sendWhatsAppMessageWithList(phone, response.text, response.list, response.buttons);
                } else if (processedMessage.startsWith('prod_')) {
                    const productId = parseInt(processedMessage.replace('prod_', ''), 10);
                    const product = await productService.getProductById(productId);
                    if (!product) {
                        response = { text: '🐾 ¡Ups! No encontramos ese producto. Elige otro o escribe "volver".', buttons: addBackButton([]) };
                        await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
                    } else if (product.sizes && product.sizes.length > 1) {
                        session.state = STATES.SELECT_SIZE;
                        session.selectedProduct = product;
                        await sessionManager.update(phone, session);
                        response = {
                            text: `📦 ${product.title}\n${product.description}\nPrecio: $${product.special_price || product.price}\nElige una talla o escribe "volver":`,
                            list: {
                                sections: [{ title: 'Tallas', rows: product.sizes.map((s, i) => ({ id: `size_${i}`, title: s })) }],
                            },
                            buttons: BUTTONS.CATALOG,
                        };
                        await sendWhatsAppMessageWithList(phone, response.text, response.list, response.buttons);
                    } else {
                        session.state = STATES.ADD_TO_CART;
                        session.selectedProduct = product;
                        session.selectedSize = product.sizes && product.sizes.length > 0 ? product.sizes[0] : 'Única';
                        await sessionManager.update(phone, session);
                        response = {
                            text: `📦 ${product.title} (${session.selectedSize})\n${product.description}\nPrecio: $${product.special_price || product.price}\n¿Cuántas unidades quieres? (Ejemplo: 2)`,
                            buttons: addBackButton([]),
                        };
                        await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
                    }
                } else if (processedMessage === 'ver_carrito') { // <-- Nuevo manejo para 'ver_carrito' en SELECT_PRODUCT
                    session.state = STATES.VIEW_CART;
                    await sessionManager.update(phone, session);
                    if (session.cart.length === 0) {
                        response = { text: '🛒 Tu carrito está vacío. ¡Añade algo delicioso para tu peludo! 🐶', buttons: addBackButton([{ id: 'ver_catalogo', title: '🛍️ Ver productos' }]) };
                    } else {
                        const cartItems = session.cart.map(item => `${item.quantity} x ${item.title} (${item.size}) - $${(item.price * item.quantity).toFixed(2)}`).join('\n');
                        const total = session.cart.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2);
                        response = { text: `🛒 Tu carrito:\n${cartItems}\nTotal: $${total}\n¿Qué quieres hacer ahora?`, buttons: BUTTONS.CART };
                    }
                    await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
                } else if (processedMessage === 'finalizar_pedido') { // <-- Nuevo manejo para 'finalizar_pedido' en SELECT_PRODUCT
                    session.state = STATES.VIEW_CART; // Asegura que el estado sea el correcto
                    await sessionManager.update(phone, session);
                    if (session.cart.length === 0) {
                        response = { text: '🛒 Tu carrito está vacío. ¡Añade productos primero! 🐶', buttons: addBackButton([{ id: 'ver_catalogo', title: '🛍️ Ver productos' }]) };
                        await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
                    } else {
                        const total = session.cart.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2);
                        response = { text: `✅ ¡Pedido finalizado! El total es $${total}. Un asesor se pondrá en contacto contigo para coordinar el pago y la entrega. ¡Gracias por tu compra! 🐾`, buttons: BUTTONS.MENU };
                        session.cart = [];
                        session.state = STATES.MENU;
                        await sessionManager.update(phone, session);
                        await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
                    }
                } else if (processedMessage === 'volver') {
                    if (session.catalog.productSubtype) {
                        session.state = STATES.SELECT_PRODUCT_SUBTYPE;
                        await sessionManager.update(phone, session);
                        const subtypesDB = await productService.getProductSubtypes(session.catalog.mainCategory, session.catalog.animal);
                        response = {
                            text: `📦 ¿Qué tipo específico de producto buscas para ${productService.ANIMAL_CATEGORY_MAP[session.catalog.animal] || session.catalog.animal}?`,
                            list: {
                                sections: [{
                                    title: 'Tipos de Producto',
                                    rows: subtypesDB.map((subtype) => ({
                                        id: `subtype_${subtype}`,
                                        title: productService.PRODUCT_TYPE_MAP[subtype] || subtype
                                    })),
                                }],
                            },
                            buttons: BUTTONS.CATALOG,
                        };
                        await sendWhatsAppMessageWithList(phone, response.text, response.list, response.buttons);
                    } else if (session.catalog.animal) {
                        session.state = STATES.SELECT_ANIMAL_BY_MAIN_CATEGORY;
                        await sessionManager.update(phone, session);
                        const animalsDB = await productService.getAnimalsByMainCategory(session.catalog.mainCategory);
                        response = {
                            text: `🐶 ¿Para qué animal buscas productos en "${productService.MAIN_CATEGORIES_MAP[session.catalog.mainCategory] || session.catalog.mainCategory}"?`,
                            list: {
                                sections: [{
                                    title: 'Animales',
                                    rows: animalsDB.map((animal) => ({
                                        id: `animal_${animal}`,
                                        title: productService.ANIMAL_CATEGORY_MAP[animal] || animal
                                    })),
                                }],
                            },
                            buttons: BUTTONS.CATALOG,
                        };
                        await sendWhatsAppMessageWithList(phone, response.text, response.list, response.buttons);
                    } else {
                        session.state = STATES.SELECT_MAIN_CATEGORY;
                        await sessionManager.update(phone, session);
                        const mainCategoriesDB = await productService.getMainCategories();
                        response = {
                            text: '🛍️ ¿Qué tipo de productos te gustaría ver hoy?',
                            list: {
                                sections: [{
                                    title: 'Categorías Principales',
                                    rows: mainCategoriesDB.map((cat) => ({
                                        id: `maincat_${cat}`,
                                        title: productService.MAIN_CATEGORIES_MAP[cat] || cat
                                    })),
                                }],
                            },
                            buttons: BUTTONS.CATALOG,
                        };
                        await sendWhatsAppMessageWithList(phone, response.text, response.list, response.buttons);
                    }
                } else if (processedMessage === 'reiniciar') {
                    await sessionManager.reset(phone);
                    response = { text: '🔁 ¡Volvamos al inicio, amigo! ¿Qué quieres para tu mascota hoy?', buttons: BUTTONS.MENU };
                    await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
                } else {
                    response = { text: '🐕 ¡Guau! Elige un producto o escribe "volver".', buttons: addBackButton([{ id: 'next', title: 'Siguiente' }]) };
                    await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
                }
                break;

            case STATES.SELECT_SIZE:
                if (processedMessage.startsWith('size_')) {
                    const sizeIndex = parseInt(processedMessage.replace('size_', ''), 10);
                    if (isNaN(sizeIndex) || sizeIndex < 0 || sizeIndex >= session.selectedProduct.sizes.length) {
                        response = { text: '🐾 ¡Ups! Esa talla no es válida. Elige una o escribe "volver".', buttons: addBackButton([]) };
                        await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
                    } else {
                        session.selectedSize = session.selectedProduct.sizes[sizeIndex];
                        session.state = STATES.ADD_TO_CART;
                        await sessionManager.update(phone, session);
                        response = {
                            text: `📦 ${session.selectedProduct.title} (${session.selectedSize})\n${session.selectedProduct.description}\nPrecio: $${session.selectedProduct.special_price || session.selectedProduct.price}\n¿Cuántas unidades quieres? (Ejemplo: 2)`,
                            buttons: addBackButton([]),
                        };
                        await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
                    }
                } else if (processedMessage === 'volver') {
                    session.state = STATES.SELECT_PRODUCT;
                    await sessionManager.update(phone, session);
                    const products = await productService.getProducts(session.catalog.mainCategory, session.catalog.animal, session.catalog.productSubtype, session.catalog.offset);
                    response = {
                        text: `🛍️ Productos en "${productService.MAIN_CATEGORIES_MAP[session.catalog.mainCategory] || session.catalog.mainCategory}" ${session.catalog.animal ? `para ${productService.ANIMAL_CATEGORY_MAP[session.catalog.animal] || session.catalog.animal}` : ''} ${session.catalog.productSubtype ? `(${productService.PRODUCT_TYPE_MAP[session.catalog.productSubtype] || session.catalog.productSubtype})` : ''}:\nToca un producto o escribe "volver".`,
                        list: {
                            sections: [{
                                title: 'Productos',
                                rows: products.map(p => ({
                                    id: `prod_${p.id}`,
                                    title: `${p.title} - $${p.special_price || p.price}`,
                                })),
                            }],
                        },
                        buttons: products.length >= 10 ? [{ id: 'next', title: 'Siguiente' }, ...BUTTONS.CATALOG] : BUTTONS.CATALOG,
                    };
                    await sendWhatsAppMessageWithList(phone, response.text, response.list, response.buttons);
                } else if (processedMessage === 'reiniciar') {
                    await sessionManager.reset(phone);
                    response = { text: '🔁 ¡Volvamos al inicio, amigo! ¿Qué quieres para tu mascota hoy?', buttons: BUTTONS.MENU };
                    await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
                } else {
                    response = { text: '🐕 ¡Guau! Elige una talla o escribe "volver".', buttons: addBackButton([]) };
                    await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
                }
                break;

            case STATES.ADD_TO_CART:
                const quantity = parseInt(processedMessage, 10);
                if (!isNaN(quantity) && quantity > 0) {
                    session.cart.push({
                        productId: session.selectedProduct.id,
                        title: session.selectedProduct.title,
                        size: session.selectedSize,
                        quantity,
                        price: session.selectedProduct.special_price || session.selectedProduct.price,
                    });
                    session.state = STATES.VIEW_CART;
                    await sessionManager.update(phone, session);
                    response = {
                        text: `✅ ${quantity} x ${session.selectedProduct.title} (${session.selectedSize}) añadido al carrito.\n¿Quieres seguir comprando o ver tu carrito?`,
                        buttons: BUTTONS.CART,
                    };
                    await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
                } else if (processedMessage === 'ver_carrito') { // <-- Manejo para 'ver_carrito' en ADD_TO_CART
                    session.state = STATES.VIEW_CART;
                    await sessionManager.update(phone, session);
                    if (session.cart.length === 0) {
                        response = { text: '🛒 Tu carrito está vacío. ¡Añade algo delicioso para tu peludo! 🐶', buttons: addBackButton([{ id: 'ver_catalogo', title: '🛍️ Ver productos' }]) };
                    } else {
                        const cartItems = session.cart.map(item => `${item.quantity} x ${item.title} (${item.size}) - $${(item.price * item.quantity).toFixed(2)}`).join('\n');
                        const total = session.cart.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2);
                        response = { text: `🛒 Tu carrito:\n${cartItems}\nTotal: $${total}\n¿Qué quieres hacer ahora?`, buttons: BUTTONS.CART };
                    }
                    await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
                } else if (processedMessage === 'finalizar_pedido') { // <-- Manejo para 'finalizar_pedido' en ADD_TO_CART
                    session.state = STATES.VIEW_CART; // Asegura que el estado sea el correcto
                    await sessionManager.update(phone, session);
                    if (session.cart.length === 0) {
                        response = { text: '🛒 Tu carrito está vacío. ¡Añade productos primero! 🐶', buttons: addBackButton([{ id: 'ver_catalogo', title: '🛍️ Ver productos' }]) };
                        await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
                    } else {
                        const total = session.cart.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2);
                        response = { text: `✅ ¡Pedido finalizado! El total es $${total}. Un asesor se pondrá en contacto contigo para coordinar el pago y la entrega. ¡Gracias por tu compra! 🐾`, buttons: BUTTONS.MENU };
                        session.cart = [];
                        session.state = STATES.MENU;
                        await sessionManager.update(phone, session);
                        await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
                    }
                } else if (processedMessage === 'volver') {
                    session.state = STATES.SELECT_PRODUCT;
                    await sessionManager.update(phone, session);
                    const products = await productService.getProducts(session.catalog.mainCategory, session.catalog.animal, session.catalog.productSubtype, session.catalog.offset);
                    response = {
                        text: `🛍️ Productos en "${productService.MAIN_CATEGORIES_MAP[session.catalog.mainCategory] || session.catalog.mainCategory}" ${session.catalog.animal ? `para ${productService.ANIMAL_CATEGORY_MAP[session.catalog.animal] || session.catalog.animal}` : ''} ${session.catalog.productSubtype ? `(${productService.PRODUCT_TYPE_MAP[session.catalog.productSubtype] || session.catalog.productSubtype})` : ''}:\nToca un producto o escribe "volver".`,
                        list: {
                            sections: [{
                                title: 'Productos',
                                rows: products.map(p => ({
                                    id: `prod_${p.id}`,
                                    title: `${p.title} - $${p.special_price || p.price}`,
                                })),
                            }],
                        },
                        buttons: products.length >= 10 ? [{ id: 'next', title: 'Siguiente' }, ...BUTTONS.CATALOG] : BUTTONS.CATALOG,
                    };
                    await sendWhatsAppMessageWithList(phone, response.text, response.list, response.buttons);
                } else if (processedMessage === 'reiniciar') {
                    await sessionManager.reset(phone);
                    response = { text: '🔁 ¡Volvamos al inicio, amigo! ¿Qué quieres para tu mascota hoy?', buttons: BUTTONS.MENU };
                    await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
                } else {
                    response = { text: '🐾 Por favor, ingresa un número válido (Ejemplo: 2) o escribe "volver".', buttons: addBackButton([]) };
                    await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
                }
                break;

            case STATES.VIEW_CART:
                if (processedMessage === 'ver_carrito') {
                    if (session.cart.length === 0) {
                        response = { text: '🛒 Tu carrito está vacío. ¡Añade algo delicioso para tu peludo! 🐶', buttons: addBackButton([{ id: 'ver_catalogo', title: '🛍️ Ver productos' }]) };
                    } else {
                        const cartItems = session.cart.map(item => `${item.quantity} x ${item.title} (${item.size}) - $${(item.price * item.quantity).toFixed(2)}`).join('\n');
                        const total = session.cart.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2);
                        response = { text: `🛒 Tu carrito:\n${cartItems}\nTotal: $${total}\n¿Qué quieres hacer ahora?`, buttons: BUTTONS.CART };
                    }
                    await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
                } else if (processedMessage === 'finalizar_pedido') {
                    if (session.cart.length === 0) {
                        response = { text: '🛒 Tu carrito está vacío. ¡Añade productos primero! 🐶', buttons: addBackButton([{ id: 'ver_catalogo', title: '🛍️ Ver productos' }]) };
                        await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
                    } else {
                        const total = session.cart.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2);
                        response = { text: `✅ ¡Pedido finalizado! El total es $${total}. Un asesor se pondrá en contacto contigo para coordinar el pago y la entrega. ¡Gracias por tu compra! 🐾`, buttons: BUTTONS.MENU };
                        session.cart = [];
                        session.state = STATES.MENU;
                        await sessionManager.update(phone, session);
                        await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
                    }
                } else if (processedMessage === 'volver') {
                    session.state = STATES.SELECT_MAIN_CATEGORY;
                    await sessionManager.update(phone, session);
                    const mainCategoriesDB = await productService.getMainCategories();
                    response = {
                        text: '🛍️ ¿Qué tipo de productos te gustaría ver hoy?',
                        list: {
                            sections: [{
                                title: 'Categorías Principales',
                                rows: mainCategoriesDB.map((cat) => ({
                                    id: `maincat_${cat}`,
                                    title: productService.MAIN_CATEGORIES_MAP[cat] || cat
                                })),
                            }],
                        },
                        buttons: BUTTONS.CATALOG,
                    };
                    await sendWhatsAppMessageWithList(phone, response.text, response.list, response.buttons);
                } else if (processedMessage === 'reiniciar') {
                    await sessionManager.reset(phone);
                    response = { text: '🔁 ¡Volvamos al inicio, amigo! ¿Qué quieres para tu mascota hoy?', buttons: BUTTONS.MENU };
                    await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
                } else {
                    response = { text: '🐕 ¡Guau! No entendí. Toca una opción del carrito.', buttons: BUTTONS.CART };
                    await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
                }
                break;

            case STATES.SOPORTE:
                if (processedMessage === 'volver') {
                    session.state = STATES.MENU;
                    session.supportAction = null;
                    await sessionManager.update(phone, session);
                    response = { text: '🐾 Volviendo al menú principal...', buttons: BUTTONS.MENU };
                    await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
                } else if (processedMessage === 'reiniciar') {
                    await sessionManager.reset(phone);
                    response = { text: '🔁 ¡Volvamos al inicio, amigo! ¿Qué quieres para tu mascota hoy?', buttons: BUTTONS.MENU };
                    await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
                } else {
                    if (session.supportAction === 'contact_agent') {
                        response = { text: `Gracias por tu mensaje: "${userMessage}". Hemos notificado a un asesor. Te contactará pronto.`, buttons: BUTTONS.MENU };
                        session.state = STATES.MENU;
                        session.supportAction = null;
                        await sessionManager.update(phone, session);
                        await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
                    } else if (session.supportAction === 'order_status') {
                        const orderNumber = processedMessage;
                        response = { text: `Gracias por preguntar por el pedido ${orderNumber}. Actualmente se encuentra en camino. Un asesor te contactará para más detalles.`, buttons: BUTTONS.MENU };
                        session.state = STATES.MENU;
                        session.supportAction = null;
                        await sessionManager.update(phone, session);
                        await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
                    } else {
                        response = { text: '💬 ¿Necesitas ayuda específica o quieres volver al menú?', buttons: addBackButton([]) };
                        await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
                    }
                }
                break;

            default:
                session.state = STATES.INIT;
                await sessionManager.update(phone, session);
                response = { text: '¡Hola! Parece que tuvimos un pequeño reinicio. ¿En qué puedo ayudarte hoy?', buttons: BUTTONS.MENU };
                await sendWhatsAppMessageWithButtons(phone, response.text, response.buttons);
                break;
        }
    } catch (error) {
        console.error('Error in handleMessage:', error);
        await sendWhatsAppMessage(phone, '¡Lo siento! Hubo un error inesperado. Por favor, intenta de nuevo más tarde o escribe "reiniciar" para empezar.');
        await sessionManager.reset(phone);
    }
};

module.exports = {
    handleMessage,
};
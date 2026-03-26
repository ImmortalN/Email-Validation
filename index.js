const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

// === НАСТРОЙКИ (Берем из Render Environment Variables) ===
const INTERCOM_TOKEN = process.env.INTERCOM_TOKEN;
const WORKER_URL = process.env.WORKER_URL; // Должен быть https://.../?email=
const INTERCOM_VERSION = '2.14';
const DEBUG = process.env.DEBUG === 'true' || process.env.DEBUG === '1';

// Хранилище ID чатов, которые уже проверены в текущей сессии
const checkedConversations = new Set();

if (!INTERCOM_TOKEN || !WORKER_URL) {
    console.error('ОШИБКА: Проверьте INTERCOM_TOKEN и WORKER_URL в настройках Render!');
    process.exit(1);
}

function log(...args) {
    if (DEBUG) console.log(`[LOG]`, ...args);
}

// === ФУНКЦИЯ ЗАПРОСА К ВОРКЕРУ ===
async function getVerificationFromWorker(email) {
    if (!email) return { exists: false, valid: false };
    try {
        log(`Запрос к воркеру для: ${email}`);
        const url = WORKER_URL.includes('?') ? `${WORKER_URL}${encodeURIComponent(email)}` : `${WORKER_URL}?email=${encodeURIComponent(email)}`;
        const res = await axios.get(url, { timeout: 10000 });
        return {
            exists: res.data.exists === true,
            valid: res.data.valid === true
        };
    } catch (e) {
        log(`Ошибка воркера для ${email}:`, e.message);
        return { exists: false, valid: false };
    }
}

// === ЛОГИКА ПРОВЕРКИ И ОБНОВЛЕНИЯ ===
async function verifyContact(contactId, conversationId) {
    if (!contactId) return;

    try {
        log(`--- Запуск верификации: Контакт ${contactId} | Чат ${conversationId} ---`);

        // 1. Получаем свежие данные контакта из Intercom
        const contactRes = await axios.get(`https://api.intercom.io/contacts/${contactId}`, {
            headers: {
                'Authorization': `Bearer ${INTERCOM_TOKEN}`,
                'Accept': 'application/json',
                'Intercom-Version': INTERCOM_VERSION
            }
        });

        const contact = contactRes.data;
        const attrs = contact.custom_attributes || {};

        // Извлекаем имейлы (учитываем регистр, который мы нашли в логах)
        const defaultEmail = contact.email;
        const purchaseEmail = attrs['Purchase email'] || attrs['Purchase Email'] || attrs['purchase_email'];

        log(`Имейлы профиля: Default=${defaultEmail || 'нет'}, Purchase=${purchaseEmail || 'нет'}`);

        let finalResult = { exists: false, valid: false };

        // 2. Шаг 1: Проверка основного Email
        if (defaultEmail) {
            log(`Проверка №1 (Default)...`);
            finalResult = await getVerificationFromWorker(defaultEmail);
        }

        // 3. Шаг 2: Проверка Purchase Email (если первый не найден в базе)
        if (!finalResult.exists && purchaseEmail) {
            log(`Default не найден. Проверка №2 (Purchase: ${purchaseEmail})...`);
            finalResult = await getVerificationFromWorker(purchaseEmail);
        }

        // 4. Шаг 3: Финальное обновление атрибутов в Intercom
        await axios.put(`https://api.intercom.io/contacts/${contactId}`, {
            custom_attributes: {
                'User exists': finalResult.exists,
                'Has active subscription': finalResult.valid
            }
        }, {
            headers: {
                'Authorization': `Bearer ${INTERCOM_TOKEN}`,
                'Content-Type': 'application/json',
                'Intercom-Version': INTERCOM_VERSION
            }
        });

        // 5. Помечаем чат как проверенный, чтобы не спамить при следующих сообщениях
        if (conversationId) {
            checkedConversations.add(conversationId);
            log(`Чат ${conversationId} добавлен в список проверенных.`);
        }

        console.log(`✅ Контакт ${contactId} успешно актуализирован.`);

    } catch (e) {
        console.error(`❌ Ошибка в процессе верификации:`, e.response?.data || e.message);
    }
}

// === ОБРАБОТЧИК ВЕБХУКА ===
app.post('/validate-email', (req, res) => {
    // Мгновенно отвечаем Intercom (200 OK)
    res.status(200).json({ ok: true });

    const body = req.body;
    const topic = body.topic;
    const item = body.data?.item;

    if (!item) return;

    const conversationId = item.id;
    const contactId = item.user?.id || 
                      item.contacts?.contacts?.[0]?.id || 
                      item.author?.id || 
                      (item.type === 'contact' ? item.id : null);

    // Логика запуска: только если это начало/ответ в чате И мы еще не проверяли этот ID чата
    const isRelevantEvent = topic === 'conversation.user.created' || topic === 'conversation.user.replied';

    if (contactId && isRelevantEvent) {
        if (!checkedConversations.has(conversationId)) {
            log(`Событие ${topic}. Начинаю проверку...`);
            verifyContact(contactId, conversationId);
        } else {
            log(`Сообщение в чате ${conversationId}, который уже проверялся. Пропускаю.`);
        }
    }
});

// Роуты для проверки работы сервера
app.get('/', (req, res) => res.send('Verifier Hybrid v6 is Online'));
app.head('/validate-email', (req, res) => res.status(200).send('OK'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}. Ожидаю вебхуки на /validate-email`);
});

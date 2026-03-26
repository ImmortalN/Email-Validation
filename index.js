const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

// === ПЕРЕМЕННЫЕ (Берем из Render) ===
const INTERCOM_TOKEN = process.env.INTERCOM_TOKEN;
const WORKER_URL = process.env.WORKER_URL; // Должен быть https://.../email=
const INTERCOM_VERSION = '2.14';
const DEBUG = process.env.DEBUG === 'true' || process.env.DEBUG === '1';

if (!INTERCOM_TOKEN || !WORKER_URL) {
    console.error('ОШИБКА: INTERCOM_TOKEN или WORKER_URL не заданы!');
    process.exit(1);
}

function log(...args) {
    if (DEBUG) console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...args);
}

// === ФУНКЦИЯ ПРОВЕРКИ ЧЕРЕЗ WORKER ===
async function checkEmail(email) {
    if (!email) return { exists: false, valid: false };
    try {
        log(`Проверка в таблице: ${email}`);
        const url = WORKER_URL.includes('?') ? `${WORKER_URL}${encodeURIComponent(email)}` : `${WORKER_URL}?email=${encodeURIComponent(email)}`;
        const res = await axios.get(url, { timeout: 10000 });
        return {
            exists: res.data.exists === true,
            valid: res.data.valid === true
        };
    } catch (e) {
        log(`Ошибка воркера (${email}):`, e.message);
        return { exists: false, valid: false };
    }
}

// === ОСНОВНАЯ ЛОГИКА ===
async function validateAndVerifyContact(contactId) {
    if (!contactId) return;

    try {
        // 1. Получаем данные контакта
        const contactRes = await axios.get(`https://api.intercom.io/contacts/${contactId}`, {
            headers: {
                'Authorization': `Bearer ${INTERCOM_TOKEN}`,
                'Accept': 'application/json',
                'Intercom-Version': INTERCOM_VERSION
            }
        });

        const contact = contactRes.data;
        const attrs = contact.custom_attributes || {};

        // Проверяем, не установлены ли уже атрибуты, чтобы не гонять код зря
        if (attrs['User exists'] !== undefined && attrs['User exists'] !== null) {
            log(`Контакт ${contactId} уже проверен ранее. Пропускаю.`);
            return;
        }

        const email = contact.email;
        const purchaseEmail = attrs['Purchase Email'] || attrs['purchase_email'];

        log(`Данные контакта ${contactId}: email=${email}, purchaseEmail=${purchaseEmail}`);

        let result = { exists: false, valid: false };

        // 2. Сначала проверяем основной email
        if (email) {
            result = await checkEmail(email);
        }

        // 3. Если не нашли, проверяем Purchase Email
        if (!result.exists && purchaseEmail) {
            log(`Основной email не найден, пробуем Purchase Email...`);
            result = await checkEmail(purchaseEmail);
        }

        // 4. Обновляем Intercom
        await axios.put(`https://api.intercom.io/contacts/${contactId}`, {
            custom_attributes: {
                'User exists': result.exists,
                'Has active subscription': result.valid
            }
        }, {
            headers: {
                'Authorization': `Bearer ${INTERCOM_TOKEN}`,
                'Content-Type': 'application/json',
                'Intercom-Version': INTERCOM_VERSION
            }
        });

        console.log(`✅ Обновлено ${contactId}: Exists=${result.exists}, Sub=${result.valid}`);

    } catch (e) {
        console.error(`[ERROR] contact ${contactId}:`, e.response?.data || e.message);
    }
}

// === WEBHOOK ENDPOINT (Путь как в старом коде) ===
app.post('/validate-email', async (req, res) => {
    const body = req.body;
    const topic = body.topic;
    const item = body.data?.item;

    if (!item) return res.status(200).send('No item');

    // Используем ваш старый проверенный способ поиска ID
    const contactId = item.contacts?.contacts?.[0]?.id || 
                      item.user?.id || 
                      item.author?.id ||
                      (item.type === 'contact' ? item.id : null);

    log(`Webhook: ${topic} | ContactID: ${contactId}`);

    if (contactId) {
        // Запускаем проверку
        validateAndVerifyContact(contactId);
    }

    res.status(200).json({ ok: true });
});

// Для проверки жизни сервера
app.get('/', (req, res) => res.send('Email Verifier is Active'));
app.head('/validate-email', (req, res) => res.status(200).send('OK'));

app.listen(process.env.PORT || 3000, () => {
    console.log(`🚀 Сервер запущен. Ожидаю вебхуки на /validate-email`);
});

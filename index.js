const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

// === НАСТРОЙКИ ===
const INTERCOM_TOKEN = process.env.INTERCOM_TOKEN;
const WORKER_URL = process.env.WORKER_URL; // Должен быть с ?email= на конце
const INTERCOM_VERSION = process.env.INTERCOM_VERSION || '2.14';
const DEBUG = process.env.DEBUG === 'true';

if (!INTERCOM_TOKEN || !WORKER_URL) {
    console.error('ОШИБКА: INTERCOM_TOKEN и WORKER_URL обязательны!');
    process.exit(1);
}

function log(message, data = '') {
    if (DEBUG) {
        console.log(`[DEBUG] ${new Date().toISOString()} | ${message}`, data);
    }
}

// === ФУНКЦИЯ ПРОВЕРКИ ЧЕРЕЗ WORKER ===
async function checkEmailViaWorker(email) {
    if (!email) return { exists: false, valid: false };
    try {
        log(`Запрос к воркеру для: ${email}`);
        // Убеждаемся, что нет двойных вопросов в URL
        const url = WORKER_URL.endsWith('=') ? WORKER_URL + encodeURIComponent(email) : `${WORKER_URL}?email=${encodeURIComponent(email)}`;
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

// === ОСНОВНАЯ ЛОГИКА ===
async function verifyAndUpdateContact(contactId) {
    try {
        log(`Начало обработки контакта: ${contactId}`);

        // 1. Получаем свежие данные контакта
        const contactRes = await axios.get(`https://api.intercom.io/contacts/${contactId}`, {
            headers: {
                'Authorization': `Bearer ${INTERCOM_TOKEN}`,
                'Accept': 'application/json',
                'Intercom-Version': INTERCOM_VERSION
            }
        });

        const contact = contactRes.data;
        const currentExists = contact.custom_attributes?.['User exists'];
        const currentSub = contact.custom_attributes?.['Has active subscription'];

        // Оптимизация: если атрибуты уже заполнены (не null/undefined), выходим
        if (currentExists !== null && currentExists !== undefined && currentSub !== null && currentSub !== undefined) {
            log(`Атрибуты уже заданы для ${contactId}. Пропускаю.`);
            return;
        }

        const email = contact.email;
        const purchaseEmail = contact.custom_attributes?.['Purchase Email'] || contact.custom_attributes?.['purchase_email'];

        let result = { exists: false, valid: false };

        // 2. Проверка основного Email
        if (email) {
            result = await checkEmailViaWorker(email);
        }

        // 3. Если не найден, проверяем Purchase Email
        if (!result.exists && purchaseEmail) {
            log(`Основной email не найден, проверяем Purchase Email: ${purchaseEmail}`);
            result = await checkEmailViaWorker(purchaseEmail);
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

        console.log(`✅ Контакт ${contactId} обновлен: Exists=${result.exists}, Sub=${result.valid}`);

    } catch (error) {
        console.error(`❌ Ошибка обработки ${contactId}:`, error.response?.data || error.message);
    }
}

// === WEBHOOK ===
app.post('/webhook', async (req, res) => {
    const { topic, data } = req.body;
    const item = data?.item;

    log(`Webhook получен. Topic: ${topic}`);

    if (!item) return res.sendStatus(200);

    // Извлекаем ID контакта (Intercom может присылать его в разных полях)
    const contactId = item.user?.id || 
                      item.contacts?.[0]?.id || 
                      (topic.includes('contact') ? item.id : null);

    if (contactId) {
        // Запускаем асинхронно, но логируем старт
        log(`Инициирована проверка для Contact ID: ${contactId}`);
        verifyAndUpdateContact(contactId);
    }

    res.status(200).send('EVENT_RECEIVED');
});

app.get('/', (req, res) => res.send('Verifier is Online'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Сервер запущен на порту ${PORT}`));

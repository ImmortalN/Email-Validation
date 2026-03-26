const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

// === НАСТРОЙКИ (Environment Variables на Render) ===
const INTERCOM_TOKEN = process.env.INTERCOM_TOKEN;
const WORKER_URL = process.env.WORKER_URL;   // обязательно: https://royal-dream-d217.immortal-333.workers.dev/?email=
const INTERCOM_VERSION = process.env.INTERCOM_VERSION || '2.14';

if (!INTERCOM_TOKEN || !WORKER_URL) {
    console.error('ОШИБКА: INTERCOM_TOKEN и WORKER_URL обязательны!');
    process.exit(1);
}

console.log('✅ Intercom Email Verifier запущен (с автоматической проверкой при conversation.user.created)');

// === ОСНОВНАЯ ФУНКЦИЯ ПРОВЕРКИ ===
async function verifyAndUpdateContact(contactId, email, purchaseEmail = null) {
    if (!contactId) {
        console.error('contactId не передан');
        return;
    }

    let exists = false;
    let hasSubscription = false;

    try {
        if (email) {
            console.log(`[Проверка] Основной email: ${email}`);
            const res = await axios.get(WORKER_URL + encodeURIComponent(email), { timeout: 10000 });
            const data = res.data;
            exists = data.exists === true;
            hasSubscription = data.valid === true;
        }

        if (!exists && purchaseEmail) {
            console.log(`[Проверка] Purchase Email: ${purchaseEmail}`);
            const res2 = await axios.get(WORKER_URL + encodeURIComponent(purchaseEmail), { timeout: 10000 });
            const data2 = res2.data;
            exists = data2.exists === true;
            hasSubscription = data2.valid === true;
        }

        // Обновляем атрибуты
        await axios.put(`https://api.intercom.io/contacts/${contactId}`, {
            custom_attributes: {
                'User exists': exists,
                'Has active subscription': hasSubscription
            }
        }, {
            headers: {
                'Authorization': `Bearer ${INTERCOM_TOKEN}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Intercom-Version': INTERCOM_VERSION
            },
            timeout: 8000
        });

        console.log(`✅ Атрибуты обновлены для контакта ${contactId} → User exists: ${exists}, Has active subscription: ${hasSubscription}`);

    } catch (error) {
        console.error(`❌ Ошибка для контакта ${contactId}:`, error.response?.status, error.response?.data || error.message);
    }
}

// === НОВЫЙ ЭНДПОИНТ ДЛЯ WEBHOOK ===
app.post('/webhook', async (req, res) => {
    const body = req.body;
    const topic = body.topic;
    const item = body.data?.item;

    if (!item) {
        return res.status(200).json({ ok: true });
    }

    // Автоматическая проверка при начале нового чата
    if (topic === 'conversation.user.created') {
        const contactId = item.contacts?.[0]?.id || item.user?.id;
        const email = item.contacts?.[0]?.email || item.user?.email;
        const purchaseEmail = item.contacts?.[0]?.custom_attributes?.['Purchase Email'] 
                           || item.custom_attributes?.['Purchase Email'];

        if (contactId) {
            console.log(`[Webhook] Новый чат начат → запускаем проверку для contact ${contactId}`);
            verifyAndUpdateContact(contactId, email, purchaseEmail);
        }
    }

    // Можно добавить и на conversation.user.replied, если хочешь проверять при каждом ответе клиента
    // if (topic === 'conversation.user.replied') { ... }

    res.status(200).json({ ok: true });
});

// Health check
app.get('/', (req, res) => {
    res.send('✅ Email Verifier работает. Webhook: /webhook');
});

app.listen(process.env.PORT || 3000, () => {
    console.log(`🚀 Сервер запущен на порту ${process.env.PORT || 3000}`);
});

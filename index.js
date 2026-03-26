const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

// === НАСТРОЙКИ (добавь их в Environment Variables на Render) ===
const INTERCOM_TOKEN = process.env.INTERCOM_TOKEN;
const WORKER_URL = process.env.WORKER_URL;   // пример: https://royal-dream-d217.immortal-333.workers.dev/?email=
const INTERCOM_VERSION = process.env.INTERCOM_VERSION || '2.14';

if (!INTERCOM_TOKEN || !WORKER_URL) {
    console.error('ОШИБКА: INTERCOM_TOKEN и WORKER_URL обязательны!');
    process.exit(1);
}

console.log('✅ Intercom Email Verifier запущен');

// === ОСНОВНАЯ ФУНКЦИЯ ПРОВЕРКИ И ОБНОВЛЕНИЯ ===
async function verifyAndUpdateContact(contactId, email, purchaseEmail = null) {
    if (!contactId) {
        console.error('contactId не передан');
        return;
    }

    let exists = false;
    let hasSubscription = false;

    try {
        // 1. Проверяем дефолтный email
        if (email) {
            console.log(`Проверяем основной email: ${email}`);
            const res = await axios.get(WORKER_URL + encodeURIComponent(email), { timeout: 10000 });
            const data = res.data;
            exists = data.exists === true;
            hasSubscription = data.valid === true;
        }

        // 2. Если не нашли — проверяем Purchase Email
        if (!exists && purchaseEmail) {
            console.log(`Проверяем Purchase Email: ${purchaseEmail}`);
            const res2 = await axios.get(WORKER_URL + encodeURIComponent(purchaseEmail), { timeout: 10000 });
            const data2 = res2.data;
            exists = data2.exists === true;
            hasSubscription = data2.valid === true;
        }

        // 3. Обновляем атрибуты в Intercom
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

        console.log(`✅ Успешно обновлено для контакта ${contactId} → User exists: ${exists}, Has active subscription: ${hasSubscription}`);

    } catch (error) {
        console.error(`❌ Ошибка при обработке контакта ${contactId}:`, 
            error.response?.data || error.message);
    }
}

// === ЭНДПОИНТ ДЛЯ ТЕСТА И ДЛЯ WEBHOOK ===
app.post('/verify-email', async (req, res) => {
    const { contact_id, email, purchase_email } = req.body;

    if (!contact_id) {
        return res.status(400).json({ error: 'contact_id обязателен' });
    }

    // Запускаем проверку асинхронно, чтобы быстро вернуть ответ
    verifyAndUpdateContact(contact_id, email, purchase_email);

    res.status(200).json({ 
        ok: true, 
        message: 'Проверка запущена. Атрибуты обновятся только у этого контакта.' 
    });
});

// === Health check ===
app.get('/', (req, res) => {
    res.send('✅ Intercom Email Verifier работает. Используй POST /verify-email');
});

app.listen(process.env.PORT || 3000, () => {
    console.log(`🚀 Сервер запущен на порту ${process.env.PORT || 3000}`);
});

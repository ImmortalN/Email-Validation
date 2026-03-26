const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

// === НАСТРОЙКИ ===
const INTERCOM_TOKEN = process.env.INTERCOM_TOKEN;
const WORKER_URL = process.env.WORKER_URL;
const INTERCOM_VERSION = process.env.INTERCOM_VERSION || '2.14';

if (!INTERCOM_TOKEN || !WORKER_URL) {
    console.error('ОШИБКА: INTERCOM_TOKEN и WORKER_URL обязательны!');
    process.exit(1);
}

console.log('✅ Email Verifier запущен — проверка при conversation.user.replied');

// === ОСНОВНАЯ ФУНКЦИЯ (с точными названиями атрибутов) ===
async function verifyAndUpdateContact(contactId) {
    if (!contactId) return;

    let email = null;
    let purchaseEmail = null;
    let exists = false;
    let hasSubscription = false;

    try {
        // Получаем свежие данные контакта
        const contactRes = await axios.get(`https://api.intercom.io/contacts/${contactId}`, {
            headers: {
                'Authorization': `Bearer ${INTERCOM_TOKEN}`,
                'Accept': 'application/json',
                'Intercom-Version': INTERCOM_VERSION
            },
            timeout: 8000
        });

        const contact = contactRes.data;
        email = contact.email;
        // Точные названия, как ты указала
        purchaseEmail = contact.custom_attributes?.['Purchase Email'] 
                     || contact.custom_attributes?.['purchase_email'];

        console.log(`[INFO] contact ${contactId} | email: ${email || '—'} | Purchase Email: ${purchaseEmail || '—'}`);

        // Проверка через Worker
        if (email) {
            const res = await axios.get(WORKER_URL + encodeURIComponent(email), { timeout: 10000 });
            const data = res.data;
            exists = data.exists === true;
            hasSubscription = data.valid === true;
        }

        if (!exists && purchaseEmail) {
            const res2 = await axios.get(WORKER_URL + encodeURIComponent(purchaseEmail), { timeout: 10000 });
            const data2 = res2.data;
            exists = data2.exists === true;
            hasSubscription = data2.valid === true;
        }

        // === ТОЧНЫЕ НАЗВАНИЯ АТРИБУТОВ (как ты создала) ===
        await axios.put(`https://api.intercom.io/contacts/${contactId}`, {
            custom_attributes: {
                'User exists': exists,           // ← точно так, с пробелом
                'Has active subscription': hasSubscription  // ← точно так, с пробелом
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

        console.log(`✅ АТРИБУТЫ ОБНОВЛЕНЫ для ${contactId} → User exists: ${exists}, Has active subscription: ${hasSubscription}`);

    } catch (error) {
        console.error(`❌ Ошибка для контакта ${contactId}:`, 
            error.response?.status, 
            error.response?.data || error.message);
    }
}

// === WEBHOOK ===
app.post('/webhook', async (req, res) => {
    const body = req.body;
    const topic = body.topic;
    const item = body.data?.item;

    if (!item) {
        return res.status(200).json({ ok: true });
    }

    let contactId = null;

    if (topic === 'conversation.user.replied') {
        contactId = item.contacts?.[0]?.id || item.user?.id || item.contact?.id;
        if (contactId) {
            console.log(`[Webhook] Клиент ответил → проверка contact ${contactId}`);
            verifyAndUpdateContact(contactId);
        }
    }

    if (topic === 'conversation.user.created') {
        contactId = item.contacts?.[0]?.id || item.user?.id;
        if (contactId) {
            console.log(`[Webhook] Новый чат → проверка contact ${contactId}`);
            verifyAndUpdateContact(contactId);
        }
    }

    res.status(200).json({ ok: true });
});

// Health check
app.get('/', (req, res) => res.send('✅ Работает. Webhook: /webhook'));

app.listen(process.env.PORT || 3000, () => {
    console.log(`🚀 Сервер запущен`);
});

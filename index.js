const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

// === НАСТРОЙКИ (Environment Variables на Render) ===
const INTERCOM_TOKEN = process.env.INTERCOM_TOKEN;
const WORKER_URL = process.env.WORKER_URL;   // https://royal-dream-d217.immortal-333.workers.dev/?email=
const INTERCOM_VERSION = process.env.INTERCOM_VERSION || '2.14';

if (!INTERCOM_TOKEN || !WORKER_URL) {
    console.error('ОШИБКА: INTERCOM_TOKEN и WORKER_URL обязательны!');
    process.exit(1);
}

console.log('✅ Email Verifier запущен — проверка при каждом ответе клиента (conversation.user.replied)');

// === ОСНОВНАЯ ФУНКЦИЯ ПРОВЕРКИ ===
async function verifyAndUpdateContact(contactId) {
    if (!contactId) return;

    let email = null;
    let purchaseEmail = null;
    let exists = false;
    let hasSubscription = false;

    try {
        // Получаем актуальные данные контакта
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
        purchaseEmail = contact.custom_attributes?.['Purchase Email'] 
                     || contact.custom_attributes?.['purchase_email'];

        console.log(`[Проверка] contact ${contactId} | email: ${email || '—'} | Purchase Email: ${purchaseEmail || '—'}`);

        // Проверяем через твой Worker
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

        // Обновляем атрибуты в Intercom
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

        console.log(`✅ Атрибуты обновлены → User exists: ${exists}, Has active subscription: ${hasSubscription}`);

    } catch (error) {
        console.error(`❌ Ошибка для контакта ${contactId}:`, error.response?.status || '', error.message);
    }
}

// === WEBHOOK — срабатывает при каждом сообщении клиента ===
app.post('/webhook', async (req, res) => {
    const body = req.body;
    const topic = body.topic;
    const item = body.data?.item;

    if (topic === 'conversation.user.replied' && item) {
        const contactId = item.contacts?.[0]?.id 
                       || item.user?.id 
                       || item.contact?.id;

        if (contactId) {
            console.log(`[Webhook] Клиент ответил → запускаем проверку для contact ${contactId}`);
            verifyAndUpdateContact(contactId);   // асинхронно
        }
    }

    // Можно оставить и на conversation.user.created на всякий случай
    if (topic === 'conversation.user.created' && item) {
        const contactId = item.contacts?.[0]?.id || item.user?.id;
        if (contactId) {
            console.log(`[Webhook] Новый чат → проверка (на случай, если email уже есть)`);
            verifyAndUpdateContact(contactId);
        }
    }

    res.status(200).json({ ok: true });
});

// Health check
app.get('/', (req, res) => {
    res.send('✅ Email Verifier активен. Webhook: /webhook');
});

app.listen(process.env.PORT || 3000, () => {
    console.log(`🚀 Сервер запущен на порту ${process.env.PORT || 3000}`);
});

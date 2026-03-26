const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

// === ПЕРЕМЕННЫЕ (все чувствительные — в Environment Variables на Render) ===
const INTERCOM_TOKEN = process.env.INTERCOM_TOKEN;
const LIST_URL = process.env.LIST_URL;
const WORKER_URL = process.env.WORKER_URL;                    // ← обязательно! пример: https://royal-dream-d217.immortal-333.workers.dev/?email=
const CUSTOM_ATTR_NAME = process.env.CUSTOM_ATTR_NAME || 'Unpaid Custom';
const ADMIN_ID = process.env.ADMIN_ID;
const PRESALE_TEAM_ID = process.env.PRESALE_TEAM_ID;
const PRESALE_NOTE_TEXT = process.env.PRESALE_NOTE_TEXT || 'Агент вийшов в онлайн — перевіряємо snoozed чати presale 😎';
const INTERCOM_VERSION = process.env.INTERCOM_VERSION || '2.14';
const DELAY_MS = 30000;
const PRESALE_FOLLOWUP_TAG_ID = '13404165';
const FOLLOW_UP_ATTR = 'Follow-Up';
const DEBUG = process.env.DEBUG === 'true' || process.env.DEBUG === '1';

const processedConversations = new Set();
const processedSubscriptionConversations = new Set();
const processedTransferConversations = new Set();

if (!INTERCOM_TOKEN || !LIST_URL || !WORKER_URL || !ADMIN_ID) {
    console.error('ОШИБКА: INTERCOM_TOKEN, LIST_URL, WORKER_URL или ADMIN_ID не заданы!');
    process.exit(1);
}

console.log('✅ Webhook + Email Verifier запущен');

// === ЛОГГИНГ ===
function log(...args) {
    if (DEBUG) console.log(...args);
}

// === ОБНОВЛЕНИЕ КАСТОМНЫХ АТРИБУТОВ ===
async function updateContactAttribute(contactId, attributes) {
    if (!contactId || !attributes) return;
    try {
        await axios.put(`https://api.intercom.io/contacts/${contactId}`, {
            custom_attributes: attributes
        }, {
            headers: {
                'Authorization': `Bearer ${INTERCOM_TOKEN}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Intercom-Version': INTERCOM_VERSION
            },
            timeout: 8000
        });
        log(`[ATTR UPDATE] Контакт ${contactId} оновлено:`, attributes);
    } catch (error) {
        console.error(`[ATTR UPDATE FAIL] Контакт ${contactId}:`, error.response?.data || error.message);
    }
}

// === НОВАЯ ФУНКЦИЯ: ТИХАЯ ПРОВЕРКА EMAIL ЧЕРЕЗ ТВОЙ WORKER ===
async function verifyAndUpdateContact(contactId, email, purchaseEmail = null) {
    if (!contactId) return;

    let exists = false;
    let hasSubscription = false;

    try {
        // 1. Проверяем основной email
        if (email) {
            const res = await axios.get(WORKER_URL + encodeURIComponent(email), { timeout: 8000 });
            const data = res.data;
            exists = data.exists === true;
            hasSubscription = data.valid === true;
        }

        // 2. Если не нашли — проверяем Purchase Email
        if (!exists && purchaseEmail) {
            const res2 = await axios.get(WORKER_URL + encodeURIComponent(purchaseEmail), { timeout: 8000 });
            const data2 = res2.data;
            exists = data2.exists === true;
            hasSubscription = data2.valid === true;
        }

        // 3. Обновляем два нужных атрибута
        await updateContactAttribute(contactId, {
            'User exists': exists,
            'Has active subscription': hasSubscription
        });

        console.log(`✅ Email проверка завершена для ${contactId} → User exists=${exists}, Has active subscription=${hasSubscription}`);

    } catch (error) {
        console.error(`❌ Ошибка проверки email для контакта ${contactId}:`, error.response?.data || error.message);
    }
}

// === ДОБАВЛЕНИЕ ЗАМЕТКИ, ТЕГА, UNSNOOZE (твой старый код) ===
async function addNoteWithDelay(conversationId, text, delay = DELAY_MS, adminId = ADMIN_ID) { /* ... твой код без изменений ... */ }
async function addTagToConversation(conversationId, tagId = PRESALE_FOLLOWUP_TAG_ID, adminId = ADMIN_ID) { /* ... твой код ... */ }
async function unsnoozeConversation(conversationId, adminId = ADMIN_ID) { /* ... твой код ... */ }
async function isFollowUpBlocked(conversationId) { /* ... твой код ... */ }
async function processSnoozedForAdmin(adminId) { /* ... твой код ... */ }

// === ОСНОВНАЯ ПРОВЕРКА Unpaid + Subscription (твой старый validateAndSetCustom) ===
async function validateAndSetCustom(contactId, conversationId) { /* ... твой код без изменений ... */ }

// === НОВЫЙ ЭНДПОИНТ ДЛЯ ТЕСТА И ДЛЯ ЧАТА ===
app.post('/verify-email', async (req, res) => {
    const { contact_id, email, purchase_email } = req.body;

    if (!contact_id) {
        return res.status(400).json({ error: 'contact_id обязателен' });
    }

    // Запускаем проверку асинхронно (чтобы Intercom получил быстрый 200)
    verifyAndUpdateContact(contact_id, email, purchase_email);

    res.status(200).json({ 
        ok: true, 
        message: 'Проверка email запущена. Атрибуты обновятся только у этого контакта.' 
    });
});

// === ТВОЙ СТАРЫЙ WEBHOOK (без изменений) ===
app.post('/validate-email', async (req, res) => {
    /* ... весь твой код app.post('/validate-email'...) без единого изменения ... */
    // (я оставил его как есть, просто вставь сюда свой полный блок)
});

// Health check
app.get('/', (req, res) => res.send('✅ Intercom Email Verifier + Webhook работает'));

app.head('/validate-email', (req, res) => res.status(200).send('OK'));
app.listen(process.env.PORT || 3000, () => {
    console.log('🚀 Сервер запущен на порту', process.env.PORT || 3000);
});

const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

const INTERCOM_TOKEN = process.env.INTERCOM_TOKEN;
const WORKER_URL = process.env.WORKER_URL; 
const INTERCOM_VERSION = '2.14';
const DEBUG = process.env.DEBUG === 'true' || process.env.DEBUG === '1';

// Хранилище проверенных чатов (чтобы не проверять на каждое сообщение в одной беседе)
const checkedConversations = new Set();

if (!INTERCOM_TOKEN || !WORKER_URL) {
    console.error('ОШИБКА: Проверьте переменные окружения!');
    process.exit(1);
}

function log(...args) {
    if (DEBUG) console.log(`[LOG]`, ...args);
}

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
        log(`Ошибка воркера (${email}):`, e.message);
        return { exists: false, valid: false };
    }
}

async function verifyContact(contactId, conversationId) {
    if (!contactId) return;

    // Если мы уже проверяли этот конкретный чат в текущей сессии сервера — выходим
    if (conversationId && checkedConversations.has(conversationId)) {
        log(`Чат ${conversationId} уже проверен в этой сессии. Пропускаю повтор.`);
        return;
    }

    try {
        log(`--- Запуск проверки для контакта ${contactId} (Чат: ${conversationId}) ---`);

        const contactRes = await axios.get(`https://api.intercom.io/contacts/${contactId}`, {
            headers: {
                'Authorization': `Bearer ${INTERCOM_TOKEN}`,
                'Accept': 'application/json',
                'Intercom-Version': INTERCOM_VERSION
            }
        });

        const contact = contactRes.data;
        const attrs = contact.custom_attributes || {};

        const defaultEmail = contact.email;
        const purchaseEmail = attrs['Purchase email'] || attrs['Purchase Email'] || attrs['purchase_email'];

        let finalResult = { exists: false, valid: false };

        // Шаг 1: Основной имейл
        if (defaultEmail) {
            finalResult = await getVerificationFromWorker(defaultEmail);
        }

        // Шаг 2: Purchase имейл (если основной не дал exists: true)
        if (!finalResult.exists && purchaseEmail) {
            log(`Default email не найден. Проверяю Purchase Email: ${purchaseEmail}`);
            finalResult = await getVerificationFromWorker(purchaseEmail);
        }

        // Шаг 3: Обновление Intercom
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

        // Запоминаем, что этот чат мы обработали
        if (conversationId) {
            checkedConversations.add(conversationId);
            // Чтобы память не переполнялась, удаляем старые ID через 24 часа (опционально)
            setTimeout(() => checkedConversations.delete(conversationId), 24 * 60 * 60 * 1000);
        }

        console.log(`✅ Контакт ${contactId} актуализирован. Exists: ${finalResult.exists}, Sub: ${finalResult.valid}`);

    } catch (e) {
        console.error(`❌ Ошибка:`, e.response?.data || e.message);
    }
}

app.post('/validate-email', (req, res) => {
    res.status(200).json({ ok: true });

    const body = req.body;
    const item = body.data?.item;
    if (!item) return;

    const conversationId = item.id; // ID текущего чата
    const contactId = item.user?.id || 
                      item.contacts?.contacts?.[0]?.id || 
                      item.author?.id || 
                      (item.type === 'contact' ? item.id : null);

    if (contactId) {
        verifyContact(contactId, conversationId);
    }
});

app.get('/', (req, res) => res.send('Verifier v6: Per-Conversation Mode'));

app.listen(process.env.PORT || 3000, () => {
    console.log(`🚀 Сервер запущен. Режим проверки каждого нового чата.`);
});

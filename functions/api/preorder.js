// Cloudflare Pages Function: POST /api/preorder
// Принимает заявку с лендинга, шлёт письмо на info@torion.su через Resend.
//
// Переменные окружения в настройках Pages → Settings → Environment variables:
//   RESEND_API_KEY  — ключ из dashboard.resend.com (re_xxx...)
//   MAIL_TO         — info@torion.su   (можно поменять без редактирования кода)
//   MAIL_FROM       — Torion <noreply@torion.su>  (должен быть на верифицированном в Resend домене)
//
// Опционально для дублирования в Telegram:
//   TG_BOT_TOKEN    — токен бота от @BotFather
//   TG_CHAT_ID      — id вашего личного чата с ботом (узнать у @userinfobot)

export async function onRequestPost({ request, env }) {
  // CORS / preflight friendliness (на тот же домен не критично, но пусть будет)
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': 'https://torion.su',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  let data;
  try {
    data = await request.json();
  } catch (_) {
    return new Response(JSON.stringify({ error: 'bad_json' }), { status: 400, headers });
  }

  // ---- Серверная валидация (клиент мог обойти) ----
  const name = String(data.name || '').trim().slice(0, 80);
  const phone = String(data.phone || '').trim().slice(0, 25);
  const email = String(data.email || '').trim().slice(0, 100).toLowerCase();
  const city = String(data.city || '').trim().slice(0, 80);
  const quantity = String(data.quantity || '').trim().slice(0, 4);
  const source = String(data.source || '').slice(0, 200);

  if (name.length < 2) return bad('name_required');
  if (!/^\+7\s?\d{3}\s?\d{3}\s?\d{2}\s?\d{2}$/.test(phone)) return bad('phone_invalid');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return bad('email_invalid');
  if (city.length < 2) return bad('city_required');
  if (!/^(1|2|3|6|12)$/.test(quantity)) return bad('quantity_invalid');

  function bad(code) {
    return new Response(JSON.stringify({ error: code }), { status: 400, headers });
  }

  // ---- Цены ----
  const PRICE = 1690;
  const total = PRICE * parseInt(quantity, 10);

  // ---- Метаданные ----
  const ipCountry = request.headers.get('cf-ipcountry') || '—';
  const ua = request.headers.get('user-agent') || '—';
  const ip = request.headers.get('cf-connecting-ip') || '—';
  const tsRu = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });

  // ---- Тело письма ----
  const subject = `Torion · Бронь №${Date.now().toString(36).toUpperCase()} · ${name}, ${city}`;

  const text = [
    `Новая заявка с torion.su`,
    `Время МСК: ${tsRu}`,
    ``,
    `Имя:        ${name}`,
    `Телефон:    ${phone}`,
    `Email:      ${email}`,
    `Город:      ${city}`,
    `Кол-во:     ${quantity} коробок`,
    `Сумма:      ${total.toLocaleString('ru-RU')} ₽`,
    ``,
    `— технические данные —`,
    `Источник:   ${source}`,
    `IP:         ${ip}`,
    `Страна:     ${ipCountry}`,
    `User-Agent: ${ua}`,
  ].join('\n');

  const html = `
<div style="font-family:Georgia,serif;color:#3A2C1E;background:#F2EBDF;padding:32px;max-width:560px;margin:0 auto">
  <div style="font-size:11px;letter-spacing:0.32em;text-transform:uppercase;color:#7A6650;margin-bottom:8px">Torion · Бронь</div>
  <div style="font-size:24px;font-style:italic;color:#3A2C1E;margin-bottom:24px">Новая заявка</div>
  <div style="font-size:12px;color:#7A6650;margin-bottom:24px">${tsRu} МСК</div>

  <table style="width:100%;border-collapse:collapse;font-size:15px">
    <tr><td style="padding:10px 0;border-bottom:1px dotted #C0A88E;color:#7A6650;width:35%">Имя</td><td style="padding:10px 0;border-bottom:1px dotted #C0A88E">${escapeHtml(name)}</td></tr>
    <tr><td style="padding:10px 0;border-bottom:1px dotted #C0A88E;color:#7A6650">Телефон</td><td style="padding:10px 0;border-bottom:1px dotted #C0A88E"><a href="tel:${escapeHtml(phone.replace(/\s/g,''))}" style="color:#8C5524">${escapeHtml(phone)}</a></td></tr>
    <tr><td style="padding:10px 0;border-bottom:1px dotted #C0A88E;color:#7A6650">Email</td><td style="padding:10px 0;border-bottom:1px dotted #C0A88E"><a href="mailto:${escapeHtml(email)}" style="color:#8C5524">${escapeHtml(email)}</a></td></tr>
    <tr><td style="padding:10px 0;border-bottom:1px dotted #C0A88E;color:#7A6650">Город</td><td style="padding:10px 0;border-bottom:1px dotted #C0A88E">${escapeHtml(city)}</td></tr>
    <tr><td style="padding:10px 0;border-bottom:1px dotted #C0A88E;color:#7A6650">Кол-во</td><td style="padding:10px 0;border-bottom:1px dotted #C0A88E">${quantity} коробок</td></tr>
    <tr><td style="padding:10px 0;color:#7A6650">Сумма</td><td style="padding:10px 0;font-size:18px;color:#8C5524">${total.toLocaleString('ru-RU')} ₽</td></tr>
  </table>

  <div style="margin-top:32px;padding-top:16px;border-top:1px solid #C0A88E;font-size:11px;color:#7A6650;font-style:italic;line-height:1.6">
    Источник: ${escapeHtml(source)}<br>
    IP: ${ip} · ${ipCountry}<br>
    UA: ${escapeHtml(ua)}
  </div>
</div>`;

  // ---- Отправка через Resend ----
  const mailTo = env.MAIL_TO || 'info@torion.su';
  const mailFrom = env.MAIL_FROM || 'Torion <noreply@torion.su>';

  if (!env.RESEND_API_KEY) {
    // Аварийный лог в Cloudflare, чтобы заявка не пропала, пока не настроен Resend
    console.log('PREORDER (no Resend key):', text);
    // Параллельно попробуем Telegram, если он настроен
    await tgNotify(env, text);
    return new Response(JSON.stringify({ ok: true, fallback: 'logged' }), { status: 200, headers });
  }

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: mailFrom,
        to: [mailTo],
        reply_to: email,
        subject: subject,
        text: text,
        html: html,
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      console.error('Resend failed:', resp.status, body);
      // Не теряем заявку — пишем в лог и пробуем телеграм
      console.log('PREORDER fallback log:', text);
      await tgNotify(env, text);
      return new Response(JSON.stringify({ ok: true, fallback: 'logged' }), { status: 200, headers });
    }
  } catch (err) {
    console.error('Resend exception:', err);
    console.log('PREORDER fallback log:', text);
    await tgNotify(env, text);
    return new Response(JSON.stringify({ ok: true, fallback: 'logged' }), { status: 200, headers });
  }

  // Параллельно — Telegram-уведомление (если настроен)
  await tgNotify(env, text);

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': 'https://torion.su',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}

// ---- helpers ----
async function tgNotify(env, text) {
  if (!env.TG_BOT_TOKEN || !env.TG_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TG_CHAT_ID,
        text: text,
        disable_web_page_preview: true,
      }),
    });
  } catch (_) { /* swallow */ }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ═══════════════════════════════════════════════════════════════
// metafields-change-log-worker — الحساب الجديد (ecommoda-dev)
// v2.2.0
// skills: worker-builder v3.0.0 · constants v2.2.0 — 12-09-2026
// D1: DB (ecommoda-dev-logs) — Storage الرئيسي + Auth + Logging
// Auth: Authorization: Bearer ${WORKER_SECRET}
// ═══════════════════════════════════════════════════════════════
//
// D1 columns المستخدمة:
//   tool       = 'metafields_change'
//   type       = 'update'
//   timestamp  = UTC ISO 8601 — نفس صيغة كل أدوات الستاك
//   order_id   = Shopify numeric ID
//   order_name = #12345
//   notes      = metafieldKey (للفلترة السريعة بدون JSON parse)
//   extra      = JSON { metafieldKey, newValue, flowTimestamp, workerTimestamp }
//   employee   = null (يُرسَل من Flow — لا يوجد موظف)
// ═══════════════════════════════════════════════════════════════

const TOOL_NAME    = 'metafields_change';
const ALLOWED_KEYS = ['manual_status', 'status_2_r_e', 'payment', 'courier'];

// ─── CORS ─────────────────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {

    // 1. CORS Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    // 2. حارس السر الغايب — لازم قبل فحص الـ auth بالظبط
    //    من غيره القالب بينتج السلسلة الحرفية "Bearer undefined"، فأي طلب
    //    معاه الهيدر ده بيعدّي. والحالة مش نظرية: سر اتضاف من غير Promote،
    //    أو اتمسح، أو Worker شبح — كلها بتدّي env.WORKER_SECRET === undefined.
    //    وعلى Worker فيه DELETE ده معناه مسح سجل بدون أي مصادقة.
    if (typeof env.WORKER_SECRET !== 'string' || !env.WORKER_SECRET.trim()) {
      return json({ ok: false, error: 'WORKER_SECRET غير مضبوط على الـ Worker', step: 'env' }, 500);
    }

    // 3. التحقق من WORKER_SECRET
    const auth = request.headers.get('Authorization');
    if (!auth || auth !== `Bearer ${env.WORKER_SECRET}`) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const url    = new URL(request.url);
    const action = url.searchParams.get('action') || '';
    const method = request.method;

    try {

      // ── D1 Auth Endpoints ────────────────────────────────────

      if (action === 'check_employee') {
        const username = url.searchParams.get('username');
        if (!username) return json({ error: 'Missing username' }, 400);
        const result = await checkEmployee(env.DB, username);
        return json({ ok: true, ...result });
      }

      if (action === 'register_pin') {
        if (method !== 'POST') return json({ error: 'Method not allowed' }, 405);
        const { username, pin } = await request.json();
        await registerPin(env.DB, username, pin);
        return json({ ok: true });
      }

      if (action === 'verify_employee') {
        if (method !== 'POST') return json({ error: 'Method not allowed' }, 405);
        const { username, pin } = await request.json();
        const displayName = await verifyEmployee(env.DB, username, pin);
        if (!displayName) return json({ ok: false, error: 'PIN خطأ أو المستخدم غير موجود' }, 401);
        await writeLog(env.DB, {
          tool:     TOOL_NAME,
          type:     'login',
          employee: username,
          notes:    `دخول: ${displayName}`,
        });
        return json({ ok: true, displayName });
      }

      if (action === 'log_logout') {
        const username = url.searchParams.get('username');
        if (username) {
          await writeLog(env.DB, {
            tool:     TOOL_NAME,
            type:     'logout',
            employee: username,
            notes:    `خروج: ${username.replace(/_/g, ' ')}`,
          });
        }
        return json({ ok: true });
      }

      if (action === 'get_employees') {
        const { results } = await env.DB.prepare(
          'SELECT username, display_name FROM employees WHERE is_active = 1 ORDER BY display_name'
        ).all();
        return json({ ok: true, employees: results });
      }

      // ── D1 Log Endpoints (السجل الرئيسي) ─────────────────────

      if (method === 'POST'   && url.pathname === '/log')        return handleLog(request, env);
      if (method === 'GET'    && url.pathname === '/logs')       return handleGetLogs(request, env);
      if (method === 'DELETE' && url.pathname === '/log')        return handleDelete(request, env);
      if (method === 'DELETE' && url.pathname === '/logs/order') return handleDeleteOrder(request, env);

      return json({ error: 'Not found' }, 404);

    } catch (err) {
      return json({ error: err.message }, 500);
    }
  },
};

// ─── POST /log ────────────────────────────────────────────────────────────────

async function handleLog(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { orderId, orderName, metafieldKey, newValue, flowTimestamp } = body;

  if (!orderId || !orderName || !metafieldKey || newValue === undefined)
    return json({ error: 'Missing required fields' }, 400);

  if (!ALLOWED_KEYS.includes(metafieldKey))
    return json({ error: 'Metafield key not allowed' }, 400);

  const numericId = orderId.includes('/') ? orderId.split('/').pop() : String(orderId);

  // ⚠️ UTC ISO — نفس صيغة كل أدوات الستاك. ممنوع أي إزاحة يدوية هنا:
  //    التخزين UTC، والتحويل لتوقيت القاهرة مكانه طبقة **العرض** (constants §13).
  //    الصيغة القديمة (`YYYY-MM-DD - HH:MM:SS` بـ UTC+3) كانت بتكسر حاجتين:
  //      ① الترتيب النصي — ' ' (0x20) أصغر من 'T' (0x54)، فكل صف مكسور بيترتّب
  //         قبل كل صف سليم في نفس اليوم، و`ORDER BY timestamp DESC LIMIT 1`
  //         بترجّع الصف الغلط **بلا أي error**.
  //      ② `new Date('2026-09-04 - 22:16:52')` → Invalid Date في JS.
  const workerTimestamp = new Date().toISOString();

  const extra = JSON.stringify({
    metafieldKey,
    newValue,
    flowTimestamp:   flowTimestamp || null,
    workerTimestamp,
  });

  await env.DB.prepare(`
    INSERT INTO logs (timestamp, tool, type, employee, order_id, order_name, notes, extra)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    workerTimestamp,
    TOOL_NAME,
    'update',
    null,
    numericId,
    orderName,
    metafieldKey,
    extra,
  ).run();

  const row = await env.DB.prepare('SELECT last_insert_rowid() AS id').first();
  return json({ success: true, id: row?.id });
}

// ─── GET /logs ────────────────────────────────────────────────────────────────

async function handleGetLogs(request, env) {
  const url         = new URL(request.url);
  const filterOrder = url.searchParams.get('orderId');
  const filterKey   = url.searchParams.get('metafieldKey');
  const filterDate  = url.searchParams.get('date');

  if (!filterOrder && !filterKey && !filterDate)
    return json({ error: 'At least one filter required', entries: [], total: 0 }, 400);

  const conditions = [`tool = '${TOOL_NAME}'`, `type = 'update'`];
  const bindings   = [];

  if (filterOrder) {
    if (filterOrder.startsWith('#') || !/^\d+$/.test(filterOrder)) {
      conditions.push('order_name = ?');
      bindings.push(filterOrder);
    } else {
      conditions.push('order_id = ?');
      bindings.push(filterOrder);
    }
  }

  if (filterKey) {
    conditions.push('notes = ?');
    bindings.push(filterKey);
  }

  if (filterDate) {
    conditions.push('timestamp LIKE ?');
    bindings.push(`${filterDate}%`);
  }

  const sql  = `
    SELECT id, timestamp, order_id, order_name, notes AS metafieldKey, extra
    FROM logs
    WHERE ${conditions.join(' AND ')}
    ORDER BY timestamp DESC
    LIMIT 500
  `;

  const stmt         = env.DB.prepare(sql);
  const bound        = bindings.length ? stmt.bind(...bindings) : stmt;
  const { results }  = await bound.all();

  const entries = results.map(row => {
    let extra = {};
    try { extra = JSON.parse(row.extra || '{}'); } catch {}
    return {
      id:              row.id,
      orderId:         row.order_id,
      orderName:       row.order_name,
      metafieldKey:    row.metafieldKey,
      newValue:        extra.newValue        ?? '',
      flowTimestamp:   extra.flowTimestamp   ?? null,
      workerTimestamp: extra.workerTimestamp ?? row.timestamp,
    };
  });

  return json({ entries, total: entries.length });
}

// ─── DELETE /log ──────────────────────────────────────────────────────────────

async function handleDelete(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { id } = body;
  if (!id) return json({ error: 'Missing id' }, 400);

  await env.DB.prepare(
    `DELETE FROM logs WHERE id = ? AND tool = '${TOOL_NAME}'`
  ).bind(id).run();

  return json({ success: true });
}

// ─── DELETE /logs/order ───────────────────────────────────────────────────────

async function handleDeleteOrder(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { orderId } = body;
  if (!orderId) return json({ error: 'Missing orderId' }, 400);

  let condition, binding;
  if (orderId.startsWith('#') || !/^\d+$/.test(orderId)) {
    condition = 'order_name = ?';
    binding   = orderId;
  } else {
    condition = 'order_id = ?';
    binding   = orderId;
  }

  const result = await env.DB.prepare(
    `DELETE FROM logs WHERE tool = '${TOOL_NAME}' AND ${condition}`
  ).bind(binding).run();

  return json({ success: true, deleted: result.meta?.changes ?? 0 });
}

// ═══════════════════════════════════════════════════════════════
// SHARED: Auth & Logging Functions — EcomModa D1 Pattern v1.2.0
// ═══════════════════════════════════════════════════════════════

async function verifyEmployee(db, username, pin) {
  const row = await db.prepare(
    'SELECT display_name, is_active FROM employees WHERE username = ? AND pin = ?'
  ).bind(username, pin).first();

  if (!row) return null;
  if (!row.is_active) throw new Error('الحساب موقوف — تواصل مع المسؤول');

  db.prepare('UPDATE employees SET last_login = ? WHERE username = ?')
    .bind(new Date().toISOString(), username)
    .run()
    .catch(() => {});

  return row.display_name;
}

async function checkEmployee(db, username) {
  const row = await db.prepare(
    'SELECT is_active, pin FROM employees WHERE username = ?'
  ).bind(username).first();

  if (!row) return { exists: false, hasPin: false, isActive: false };
  return { exists: true, hasPin: !!row.pin, isActive: !!row.is_active };
}

async function registerPin(db, username, pin) {
  const row = await db.prepare(
    'SELECT pin, is_active FROM employees WHERE username = ?'
  ).bind(username).first();

  if (!row)           throw new Error('اسم المستخدم غير موجود');
  if (!row.is_active) throw new Error('الحساب موقوف — تواصل مع المسؤول');
  if (row.pin)        throw new Error('هذا المستخدم مسجّل بالفعل — تواصل مع المسؤول لإعادة الضبط');

  await db.prepare('UPDATE employees SET pin = ? WHERE username = ?')
    .bind(pin, username).run();
  return true;
}

async function writeLog(db, entry) {
  await db.prepare(`
    INSERT INTO logs
      (timestamp, tool, type, employee, order_id, order_name,
       sku, product_title, delta, value_before, value_after, notes, extra)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    entry.timestamp    ?? new Date().toISOString(),
    entry.tool,
    entry.type,
    entry.employee     ?? null,
    entry.orderId      ?? null,
    entry.orderName    ?? null,
    entry.sku          ?? null,
    entry.productTitle ?? null,
    entry.delta        ?? null,
    entry.valueBefore  ?? null,
    entry.valueAfter   ?? null,
    entry.notes        ?? null,
    entry.extra ? JSON.stringify(entry.extra) : null,
  ).run();
}

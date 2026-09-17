// ═══════════════════════════════════════════════════════════════
// metafields-change-log-worker — الحساب الجديد (ecommoda-dev)
// v2.3.0
// skills: worker-builder v3.0.0 · constants v2.2.0 — 17-09-2026
// D1: DB (ecommoda-dev-logs) — Storage الرئيسي + Auth + Logging
// Auth: Authorization: Bearer ${WORKER_SECRET}
// ═══════════════════════════════════════════════════════════════
//
// D1 columns المستخدمة:
//   tool       = 'metafields_change'
//   type       = 'update'
//   timestamp  = UTC ISO 8601 — من v2.2.0
//   order_id   = Shopify numeric ID
//   order_name = #12345
//   notes      = metafieldKey (للفلترة السريعة بدون JSON parse)
//   extra      = JSON { metafieldKey, newValue, flowTimestamp, workerTimestamp }
//   employee   = null (يُرسَل من Flow — لا يوجد موظف)
//
// ⚠️ `metafields_change` صندوق مشترك — ٦ أدوات تانية بتكتب تحته وبتسيب علامة
//    في extra.source / extra.sourceTool. صفوف الأداة دي (من Shopify Flow)
//    مالهاش أي مفتاح منهم — وده اللي بيميّزها. (constants §7)
// ═══════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════
// §CONSTANTS
// ══════════════════════════════════════════════════════

const TOOL_NAME      = 'metafields_change';
const WORKER_VERSION = '2.3.0';
const ALLOWED_KEYS   = ['manual_status', 'status_2_r_e', 'payment', 'courier'];

// ══════════════════════════════════════════════════════
// §CORS — Option B (allowlist)
// ══════════════════════════════════════════════════════
// الأداة فيها DELETE (صف واحد وكل صفوف أوردر) فالقاعدة بتقول allowlist
// مش wildcard. ⚠️ Shopify Flow **مش متأثر**: هو بينادي من السيرفر بلا
// `Origin` header، والـ CORS حماية متصفح بس.

const ALLOWED_ORIGINS = [
  'https://ecommoda-dev.github.io',
];

function getCORS(request) {
  const origin  = request?.headers?.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  };
}

// ══════════════════════════════════════════════════════
// §HELPERS
// ══════════════════════════════════════════════════════

function json(data, status = 200, request = null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...getCORS(request) },
  });
}

// عمود `timestamp` فيه صيغتين: ISO (من v2.2.0) والقديمة
// `YYYY-MM-DD - HH:MM:SS` بتوقيت القاهرة. الفحص ده بيعدّ القديمة عشان
// تقدر تتابع تقدّم الـ backfill من `?action=diag`.
const LEGACY_TS_SQL = `timestamp NOT LIKE '____-__-__T%'`;

// ══════════════════════════════════════════════════════
// §SHARED — copy verbatim — never modify
// SHARED: Auth & Logging Functions — EcomModa D1 Pattern v1.3.0
// ══════════════════════════════════════════════════════

async function verifyEmployee(db, username, pin) {
  const row = await db.prepare(
    'SELECT display_name, is_active FROM employees WHERE username = ? AND pin = ?'
  ).bind(username, pin).first();

  if (!row) return null;

  if (!row.is_active) {
    throw new Error('الحساب موقوف — تواصل مع المسؤول');
  }

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
  return {
    exists:   true,
    hasPin:   !!row.pin,
    isActive: !!row.is_active,
  };
}

async function registerPin(db, username, pin) {
  const row = await db.prepare(
    'SELECT pin, is_active FROM employees WHERE username = ?'
  ).bind(username).first();

  if (!row)           throw new Error('اسم المستخدم غير موجود');
  if (!row.is_active) throw new Error('الحساب موقوف — تواصل مع المسؤول');
  if (row.pin)        throw new Error('هذا المستخدم مسجّل بالفعل — تواصل مع المسؤول لإعادة الضبط');

  await db.prepare('UPDATE employees SET pin = ? WHERE username = ?')
    .bind(pin, username)
    .run();

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
    entry.extra ? JSON.stringify(entry.extra) : null
  ).run();
}

const LOG_EXPORT_MAX = 2000;   // سقف التصدير — بيرجع للواجهة كـ `cap`

function buildLogFilterSQL(select, {
  tool      = null,
  employee  = null, employees = null,
  type      = null, types     = null,
  search    = null,
  dateFrom  = null, dateTo    = null,
} = {}) {
  let sql = `${select} FROM logs WHERE type NOT IN ('login','logout')`;
  const b = [];

  const emps = Array.isArray(employees) && employees.length ? employees : (employee ? [employee] : []);
  const typs = Array.isArray(types)     && types.length     ? types     : (type     ? [type]     : []);

  if (tool) { sql += ' AND tool = ?'; b.push(tool); }
  if (emps.length) {
    sql += ` AND employee IN (${emps.map(() => '?').join(',')})`; b.push(...emps);
  }
  if (typs.length) {
    sql += ` AND type IN (${typs.map(() => '?').join(',')})`; b.push(...typs);
  }
  if (search) {
    sql += ' AND (order_name LIKE ? OR notes LIKE ?)';
    b.push(`%${search}%`, `%${search}%`);
  }
  if (dateFrom) { sql += ' AND substr(timestamp, 1, 10) >= ?'; b.push(dateFrom); }
  if (dateTo)   { sql += ' AND substr(timestamp, 1, 10) <= ?'; b.push(dateTo); }

  return { sql, b };
}

// ⚠️ قائمة **مقفولة** — القيمة جاية من العميل وبتتلزق في نص SQL مباشرةً
//    (ORDER BY مابيقبلش bind). أي قيمة بره القايمة بترجع للافتراضي بدون خطأ.
// ⚠️ المفاتيح لازم تطابق `data-sort-key` في الواجهة **حرفيًا**.
const LOG_SORT_COLUMNS = {
  date: 'timestamp', time: 'timestamp', orderName: 'order_name',
  metafieldKey: 'notes', newValue: `json_extract(extra, '$.newValue')`,
};

function orderByClause(sortBy, sortDir) {
  const col = LOG_SORT_COLUMNS[String(sortBy || '')] || 'timestamp';
  const dir = String(sortDir || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  // 🔴 كاسر تعادل إلزامي: من غيره صفوف نفس القيمة بترتيب عشوائي بين الصفحات،
  //    والصف الواحد ممكن يظهر في صفحتين **أو مايظهرش خالص**.
  return col === 'timestamp' ? ` ORDER BY timestamp ${dir}`
                             : ` ORDER BY ${col} ${dir}, timestamp DESC`;
}

function logParamsFrom(url, tool) {
  const csv = (k) => (url.searchParams.get(k) || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const employees = csv('employees'), types = csv('types');
  return {
    tool,
    employees: employees.length ? employees : null,
    employee:  url.searchParams.get('employee') || null,
    types:     types.length ? types : null,
    type:      url.searchParams.get('type')     || null,
    search:    url.searchParams.get('search')   || null,
    dateFrom:  url.searchParams.get('dateFrom') || null,
    dateTo:    url.searchParams.get('dateTo')   || null,
  };
}

// ══════════════════════════════════════════════════════
// END SHARED BLOCK
// ══════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════
// §LOG — امتداد الفلترة الخاص بالأداة، فوق §SHARED مش بدلها
// ══════════════════════════════════════════════════════
// الأداة دي مالهاش أبعاد `employee` ولا `type` حقيقية (كل صفوف الـ update
// جاية من Flow بـ employee = null و type = 'update')، فالفلاتر المعنوية
// هنا: رقم الأوردر · الـ metafield key · القيمة الجديدة · التاريخ.
// الامتداد بيتبني **فوق** ناتج buildLogFilterSQL عشان §SHARED تفضل verbatim.

// ─── §LOG::params ───
function toolLogParams(url) {
  const csv = (k) => (url.searchParams.get(k) || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  return { orders: csv('orders'), keys: csv('keys'), values: csv('values') };
}

// ─── §LOG::buildSQL ───
function buildToolLogSQL(select, url) {
  // ⚠️ `search` بيتشال من buildLogFilterSQL عن قصد وبيتبني هنا أوسع:
  //    المشتركة بتدوّر في order_name و notes بس، والأداة دي محتاجة كمان
  //    order_id (بحث برقم الأوردر الرقمي) والقيمة الجديدة. §SHARED نفسها
  //    ما اتلمستش — الامتداد فوقها.
  const base = { ...logParamsFrom(url, TOOL_NAME), search: null };
  const { sql, b } = buildLogFilterSQL(select, base);
  let s = sql;
  const bb = [...b];
  const f = toolLogParams(url);

  const search = (url.searchParams.get('search') || '').trim();
  if (search) {
    const like = `%${search}%`;
    s += ` AND (order_name LIKE ? OR order_id LIKE ? OR notes LIKE ?`
       + ` OR json_extract(extra, '$.newValue') LIKE ?)`;
    bb.push(like, like, like, like);
  }

  if (f.orders.length) {
    const ph = f.orders.map(() => '?').join(',');
    // الأوردر بيتكتب بالاسم (#1780) وبالـ ID الرقمي — الاتنين مقبولين
    s += ` AND (order_name IN (${ph}) OR order_id IN (${ph}))`;
    bb.push(...f.orders, ...f.orders);
  }
  if (f.keys.length) {
    s += ` AND notes IN (${f.keys.map(() => '?').join(',')})`;
    bb.push(...f.keys);
  }
  if (f.values.length) {
    s += ` AND json_extract(extra, '$.newValue') IN (${f.values.map(() => '?').join(',')})`;
    bb.push(...f.values);
  }
  return { sql: s, b: bb };
}

// ─── §LOG::mapRow — شكل الصف الراجع للواجهة، مصدر واحد للتلات endpoints ───
// ⚠️ `workerTimestamp` بيعمل fallback على `row.timestamp` — وده الحقل اللي
//    الواجهة بتعرضه. `flowTimestamp` **مش** بتوقيت القاهرة في الصفوف
//    التاريخية (الـ Flow كان بيكتب +2 والقاهرة +3) فمينفعش يتعرض كأنه القاهرة.
function mapRow(row) {
  let extra = {};
  try { extra = JSON.parse(row.extra || '{}'); } catch {}
  return {
    id:              row.id,
    orderId:         row.order_id,
    orderName:       row.order_name,
    metafieldKey:    row.notes,
    newValue:        extra.newValue        ?? '',
    flowTimestamp:   extra.flowTimestamp   ?? null,
    workerTimestamp: extra.workerTimestamp ?? row.timestamp,
    timestamp:       row.timestamp,
  };
}

// ─── §LOG::readPaging — حراسة إلزامية مش تجميل ───
// 🔴 parseInt('abc') → NaN · Math.min(NaN,100) → NaN → بيوصل لـ D1 كـ bind
//    ويرجّع خطأ غامض.
function readPaging(url) {
  const limitRaw  = parseInt(url.searchParams.get('limit')  || '100', 10);
  const offsetRaw = parseInt(url.searchParams.get('offset') || '0',   10);
  return {
    limit:  Number.isFinite(limitRaw)  ? Math.min(Math.max(limitRaw, 1), 100) : 100,
    offset: Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0,
  };
}

// ══════════════════════════════════════════════════════
// §HANDLER
// ══════════════════════════════════════════════════════

export default {
  async fetch(request, env) {

    // 1. CORS Preflight — ALWAYS first
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: getCORS(request) });
    }

    // 2. حارس السر الغايب — لازم قبل فحص الـ auth بالظبط
    //    من غيره القالب بينتج السلسلة الحرفية "Bearer undefined"، فأي طلب
    //    معاه الهيدر ده بيعدّي. والحالة مش نظرية: سر اتضاف من غير Promote،
    //    أو اتمسح، أو Worker شبح — كلها بتدّي env.WORKER_SECRET === undefined.
    //    وعلى Worker فيه DELETE ده معناه مسح سجل بدون أي مصادقة.
    if (typeof env.WORKER_SECRET !== 'string' || !env.WORKER_SECRET.trim()) {
      return json({ ok: false, error: 'WORKER_SECRET غير مضبوط على الـ Worker', step: 'env' }, 500, request);
    }

    // 3. التحقق من WORKER_SECRET
    const auth = request.headers.get('Authorization');
    if (!auth || auth !== `Bearer ${env.WORKER_SECRET}`) {
      return json({ error: 'Unauthorized' }, 401, request);
    }

    const url    = new URL(request.url);
    const action = url.searchParams.get('action') || '';
    const method = request.method;

    try {

      // ─── §AUTH ────────────────────────────────────────────

      if (action === 'check_employee') {
        const username = url.searchParams.get('username');
        if (!username) return json({ error: 'Missing username' }, 400, request);
        const result = await checkEmployee(env.DB, username);
        return json({ ok: true, ...result }, 200, request);
      }

      if (action === 'register_pin') {
        if (method !== 'POST') return json({ error: 'Method not allowed' }, 405, request);
        const { username, pin } = await request.json().catch(() => ({}));
        if (!username || !pin) return json({ error: 'Missing username or pin' }, 400, request);
        await registerPin(env.DB, username, pin);
        return json({ ok: true }, 200, request);
      }

      if (action === 'verify_employee') {
        if (method !== 'POST') return json({ error: 'Method not allowed' }, 405, request);
        const { username, pin } = await request.json().catch(() => ({}));
        if (!username || !pin) return json({ error: 'Missing username or pin' }, 400, request);
        const displayName = await verifyEmployee(env.DB, username, pin);
        if (!displayName) return json({ ok: false, error: 'PIN خطأ أو المستخدم غير موجود' }, 401, request);

        // فشل السجل يبان — العملية تمّت، بس الواجهة تعرف إنها ما اتسجلتش
        let logged = true, logError = null;
        try {
          await writeLog(env.DB, {
            tool: TOOL_NAME, type: 'login', employee: username,
            notes: `دخول: ${displayName}`,
          });
        } catch (e) { logged = false; logError = e.message; }

        return json({ ok: true, displayName, logged, logError }, 200, request);
      }

      if (action === 'log_logout') {
        const username = url.searchParams.get('username');
        let logged = true, logError = null;
        if (username) {
          try {
            await writeLog(env.DB, {
              tool: TOOL_NAME, type: 'logout', employee: username,
              notes: `خروج: ${username.replace(/_/g, ' ')}`,
            });
          } catch (e) { logged = false; logError = e.message; }
        }
        return json({ ok: true, logged, logError }, 200, request);
      }

      if (action === 'get_employees') {
        const { results } = await env.DB.prepare(
          'SELECT username, display_name FROM employees WHERE is_active = 1 ORDER BY display_name'
        ).all();
        return json({ ok: true, employees: results }, 200, request);
      }

      // ─── §DIAG ────────────────────────────────────────────

      if (action === 'get_config') {
        return json({
          ok: true, version: WORKER_VERSION, tool: TOOL_NAME,
          allowedKeys: ALLOWED_KEYS, logExportMax: LOG_EXPORT_MAX,
        }, 200, request);
      }

      if (action === 'diag') {
        // ⚠️ ممنوع يرجّع قيمة أي سر — أسماء وأطوال بس.
        //    (الطول بيكشف المسافة المخفية في آخر السر — سبب 401 متكرر.)
        const checks = [];
        const push = (ok, label, detail) => checks.push({ ok, label, detail });

        const envKeys = Object.keys(env).sort()
          .map(k => `${k}(${typeof env[k] === 'string' ? env[k].length : typeof env[k]})`);
        push(true, 'متغيّرات البيئة', envKeys.join(' · ') || '— لا شيء');

        const sec = env.WORKER_SECRET;
        push(typeof sec === 'string' && sec.trim().length > 0 && sec === sec.trim(),
             'WORKER_SECRET',
             typeof sec !== 'string' ? 'غير مضبوط'
               : sec !== sec.trim() ? `⚠️ فيه مسافة زائدة — الطول ${sec.length}`
               : `مضبوط — الطول ${sec.length}`);

        push(!!env.DB, 'الـ binding DB', env.DB ? 'موجود' : '❌ ناقص — راجع wrangler.toml');

        try {
          const r = await env.DB.prepare(
            `SELECT COUNT(*) AS n,
                    SUM(CASE WHEN ${LEGACY_TS_SQL} THEN 1 ELSE 0 END) AS legacy,
                    MIN(timestamp) AS oldest, MAX(timestamp) AS newest
             FROM logs WHERE tool = ?`
          ).bind(TOOL_NAME).first();
          push(true, 'D1 — جدول logs',
               `${(r?.n ?? 0).toLocaleString('en-US')} صف تحت ${TOOL_NAME} · ` +
               `أقدم ${r?.oldest || '—'} · أحدث ${r?.newest || '—'}`);
          const legacy = r?.legacy ?? 0;
          push(legacy === 0, 'صيغة عمود timestamp',
               legacy === 0
                 ? 'كل الصفوف UTC ISO ✓'
                 : `${legacy.toLocaleString('en-US')} صف لسه بالصيغة القديمة ` +
                   `(YYYY-MM-DD - HH:MM:SS بتوقيت القاهرة) — الـ backfill لسه ما اتعملش`);
        } catch (e) {
          push(false, 'D1 — جدول logs', `❌ ${e.message}`);
        }

        try {
          const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM employees WHERE is_active = 1').first();
          push(true, 'D1 — جدول employees', `${r?.n ?? 0} موظف فعّال`);
        } catch (e) {
          push(false, 'D1 — جدول employees', `❌ ${e.message}`);
        }

        const origin = request.headers.get('Origin') || '— بلا Origin (نداء من سيرفر)';
        push(ALLOWED_ORIGINS.includes(origin) || origin.startsWith('—'),
             'الـ Origin', `${origin} · المسموح: ${ALLOWED_ORIGINS.join(' · ')}`);

        return json({ ok: true, version: WORKER_VERSION, checks }, 200, request);
      }

      // ─── §LOG-ENDPOINTS ───────────────────────────────────

      if (action === 'get_logs') {
        const { limit, offset } = readPaging(url);
        const { sql, b } = buildToolLogSQL('SELECT *', url);
        const q = sql
          + orderByClause(url.searchParams.get('sortBy'), url.searchParams.get('sortDir'))
          + ' LIMIT ? OFFSET ?';
        const { results } = await env.DB.prepare(q).bind(...b, limit, offset).all();
        return json({ ok: true, entries: results.map(mapRow) }, 200, request);
      }

      if (action === 'get_logs_count') {
        const { sql, b } = buildToolLogSQL('SELECT COUNT(*) AS total', url);
        const row = await env.DB.prepare(sql).bind(...b).first();
        return json({ ok: true, total: row?.total ?? 0 }, 200, request);
      }

      if (action === 'get_logs_export') {
        // ⚠️ الصفوف **والحقيقة** مع بعض — الواجهة ماتحسبش السقف عندها.
        const { sql, b } = buildToolLogSQL('SELECT *', url);
        const cnt = buildToolLogSQL('SELECT COUNT(*) AS total', url);
        const [rows, countRow] = await Promise.all([
          env.DB.prepare(sql + ' ORDER BY timestamp DESC LIMIT ?').bind(...b, LOG_EXPORT_MAX).all(),
          env.DB.prepare(cnt.sql).bind(...cnt.b).first(),
        ]);
        const total = countRow?.total ?? 0;
        return json({
          ok: true, entries: rows.results.map(mapRow),
          cap: LOG_EXPORT_MAX, total, truncated: total > LOG_EXPORT_MAX,
        }, 200, request);
      }

      if (action === 'get_filter_options') {
        // قيم الفلاتر المتاحة فعلاً في البيانات — الواجهة بتكاشها بـ TTL قصير
        // (Standards #45): القوايم بتتغيّر من داشبورد شوبيفاي بلا أي إشعار.
        const { results } = await env.DB.prepare(
          `SELECT notes AS k, json_extract(extra, '$.newValue') AS v, COUNT(*) AS n
           FROM logs WHERE tool = ? AND type = 'update' AND notes IS NOT NULL
           GROUP BY 1, 2 ORDER BY n DESC LIMIT 400`
        ).bind(TOOL_NAME).all();

        const keys = [...new Set(results.map(r => r.k).filter(Boolean))].sort();
        const values = [...new Set(results.map(r => r.v).filter(v => v != null && v !== ''))].sort();
        return json({ ok: true, keys, values, allowedKeys: ALLOWED_KEYS }, 200, request);
      }

      // ─── §LEGACY-PATHS — المسارات القديمة (الـ Flow بينادي POST /log) ──

      if (method === 'POST'   && url.pathname === '/log')        return handleLog(request, env);
      if (method === 'GET'    && url.pathname === '/logs')       return handleGetLogs(request, env);
      if (method === 'DELETE' && url.pathname === '/log')        return handleDelete(request, env);
      if (method === 'DELETE' && url.pathname === '/logs/order') return handleDeleteOrder(request, env);

      return json({ error: 'Not found' }, 404, request);

    } catch (err) {
      return json({ error: err.message }, 500, request);
    }
  },
};

// ─── POST /log — نقطة دخول Shopify Flow ───────────────────────────────────────

async function handleLog(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, request); }

  const { orderId, orderName, metafieldKey, newValue, flowTimestamp } = body;

  if (!orderId || !orderName || !metafieldKey || newValue === undefined)
    return json({ error: 'Missing required fields' }, 400, request);

  if (!ALLOWED_KEYS.includes(metafieldKey))
    return json({ error: 'Metafield key not allowed' }, 400, request);

  // String() قبل أي عملية نصية — الـ Flow بيبعت نص، لكن أي نداء تاني ممكن
  // يبعت رقم و`.includes` وقتها بترمي TypeError.
  const rawId     = String(orderId);
  const numericId = rawId.includes('/') ? rawId.split('/').pop() : rawId;

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

  // 🔴 الـ id بيتقرا من `meta.last_row_id` بتاعة نفس النداء — مش باستعلام
  //    تاني. النمط القديم (`SELECT last_insert_rowid()`) كان بيفتح نافذة
  //    تكرار حقيقية: الـ INSERT ينجح، الاستعلام التاني يرمي، الـ catch يرجّع
  //    500، والـ Flow (معمول له Retry على 5XX) يبعت تاني → **صف مكرر**.
  const res = await env.DB.prepare(`
    INSERT INTO logs (timestamp, tool, type, employee, order_id, order_name, notes, extra)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    workerTimestamp, TOOL_NAME, 'update', null,
    numericId, orderName, metafieldKey, extra,
  ).run();

  return json({ success: true, id: res?.meta?.last_row_id ?? null }, 200, request);
}

// ─── GET /logs — مسار قديم، متساب للتوافق ────────────────────────────────────
// الواجهة من v3.0.0 بتستخدم `?action=get_logs` (فلاتر قوايم + صفحات).
// ⚠️ اتصلّح هنا: `total` كان بيرجّع **عدد صفوف الصفحة** (بحد أقصى ٥٠٠) وبيتعرض
//    كأنه إجمالي النتايج — رقم مضلّل بلا أي تحذير. دلوقتي بيرجّع العدّ الحقيقي
//    ومعاه `truncated`.

async function handleGetLogs(request, env) {
  const url         = new URL(request.url);
  const filterOrder = url.searchParams.get('orderId');
  const filterKey   = url.searchParams.get('metafieldKey');
  const filterDate  = url.searchParams.get('date');

  if (!filterOrder && !filterKey && !filterDate)
    return json({ error: 'At least one filter required', entries: [], total: 0 }, 400, request);

  const LEGACY_CAP = 500;
  const conditions = ['tool = ?', `type = 'update'`];
  const bindings   = [TOOL_NAME];

  if (filterOrder) {
    if (filterOrder.startsWith('#') || !/^\d+$/.test(filterOrder)) {
      conditions.push('order_name = ?'); bindings.push(filterOrder);
    } else {
      conditions.push('order_id = ?');   bindings.push(filterOrder);
    }
  }
  if (filterKey)  { conditions.push('notes = ?');          bindings.push(filterKey); }
  if (filterDate) { conditions.push('timestamp LIKE ?');   bindings.push(`${filterDate}%`); }

  const where = `FROM logs WHERE ${conditions.join(' AND ')}`;
  const [rows, countRow] = await Promise.all([
    env.DB.prepare(`SELECT * ${where} ORDER BY timestamp DESC LIMIT ?`).bind(...bindings, LEGACY_CAP).all(),
    env.DB.prepare(`SELECT COUNT(*) AS total ${where}`).bind(...bindings).first(),
  ]);

  const total = countRow?.total ?? 0;
  return json({
    entries: rows.results.map(mapRow),
    total, cap: LEGACY_CAP, truncated: total > LEGACY_CAP,
  }, 200, request);
}

// ─── DELETE /log ──────────────────────────────────────────────────────────────
// ⚠️ بند مفتوح: الحذف لسه **بلا `writeLog`** — مفيش اسم موظف ولا سبب ولا أثر.
//    الإصلاح متوقّف على تسجيل قيمة `type` جديدة في `ecommoda-constants` §7
//    **قبل** أول كتابة (worker-builder Rule 7). راجع "مسائل مفتوحة" في CLAUDE.md.

async function handleDelete(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, request); }

  const { id } = body;
  if (!id) return json({ error: 'Missing id' }, 400, request);

  const res = await env.DB.prepare(
    'DELETE FROM logs WHERE id = ? AND tool = ?'
  ).bind(id, TOOL_NAME).run();

  return json({ success: true, deleted: res?.meta?.changes ?? 0 }, 200, request);
}

// ─── DELETE /logs/order ───────────────────────────────────────────────────────

async function handleDeleteOrder(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, request); }

  const { orderId } = body;
  if (!orderId) return json({ error: 'Missing orderId' }, 400, request);

  const raw = String(orderId);
  const condition = (raw.startsWith('#') || !/^\d+$/.test(raw)) ? 'order_name = ?' : 'order_id = ?';

  const res = await env.DB.prepare(
    `DELETE FROM logs WHERE tool = ? AND ${condition}`
  ).bind(TOOL_NAME, raw).run();

  return json({ success: true, deleted: res?.meta?.changes ?? 0 }, 200, request);
}

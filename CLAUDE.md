# سجل تغييرات حالة الأوردر (`Order-Status-History`)

**بتعمل إيه:** تسجّل كل تغيير في حالة الأوردر (S1/S2/الدفع/الكوريير) في D1، وفيها شاشة دخول موظفين وسجل بحث بالأوردر/الحالة/التاريخ.
**مين بيستخدمها:** أي موظف محتاج يراجع تاريخ تغييرات حالة أوردر معيّن.
**الإصدار:** Worker `v2.2.0` · الواجهة `v2.1.0`

> ⚠️ **الاسم الداخلي في الكود مختلف عن اسم الريبو/الـ Worker:** الكود بيسمي
> نفسه `metafields-change-log-worker` (موثّق في `ecommoda-constants` §7) —
> ده طبيعي، مش خطأ نقل. القيمة المسجّلة في D1 هي `tool = 'metafields_change'`.

## الروابط

```
الواجهة    : https://ecommoda-dev.github.io/Order-Status-History/
الـ Worker : https://order-status-history-worker.ecommoda-dev.workers.dev
اسم الـ Worker في الداشبورد: order-status-history-worker     ← مطابق لـ name في wrangler.toml
```

## الـ Endpoints

| `?action=` / مسار | بيعمل إيه |
|---|---|
| `check_employee` | فحص وجود موظف قبل تسجيل PIN |
| `register_pin` | تسجيل PIN لأول مرة |
| `verify_employee` | تسجيل الدخول (PIN) |
| `log_logout` | تسجيل خروج |
| `get_employees` | قائمة الموظفين الفعّالين |
| `POST /log` | تسجيل تغيير حالة جديد |
| `GET /logs` | البحث في السجل (لازم فلتر واحد على الأقل: orderId/metafieldKey/date) |
| `DELETE /log` | حذف صف واحد بالـ id |
| `DELETE /logs/order` | حذف كل صفوف أوردر معيّن |

## D1

```
tool      : metafields_change
type      : update · login · logout
timestamp : UTC ISO 8601 — من v2.2.0 (12-09-2026)
```

> ⚠️ **`metafields_change` مش أداة واحدة — ده صندوق مشترك.** ٦ أدوات تانية
> بتكتب تحت نفس القيمة (`ecommoda-constants` §7)، وبتسيب علامة في
> `extra.source` أو `extra.sourceTool`. صفوف الأداة دي (الجاية من Shopify
> Flow) **مالهاش أي مفتاح منهم** — ده اللي بيميّزها. أي جرد بيعدّ الصف ده
> على إنه أداة واحدة **هيغلط**، ولازم يقرا:
> `COALESCE(json_extract(extra,'$.source'), json_extract(extra,'$.sourceTool'))`

> مسجّلة بالفعل في `ecommoda-constants` §7 — مفيش قيم جديدة محتاجة إضافة.

## المضبوط فعليًا في الداشبورد

> اللي **متظبط بالفعل** — مش اللي المفروض يكون.

```
Bindings : DB → ecommoda-dev-logs
Secrets  : WORKER_SECRET
Vars     : لا يوجد — الكود مفيهوش أي env.* غير env.DB و env.WORKER_SECRET
Build watch paths : * (الافتراضي — لسه ما اتضيّقتش)
```

## CORS

`Access-Control-Allow-Origin: *` (wildcard) — من الكود الأصلي كما هو، لم يُعدَّل أثناء النقل.

## خط الأساس بعد النقل

> لم يُسجَّل خط أساس رقمي قبل النقل — الأداة أداة بحث/سجل (مش أرقام تراكمية
> واضحة يسهل مقارنتها). اتنقلت بلا خط أساس — بند ١٠ (§11 في سكيل النقل) مفتوح بوعي.
> بعد الربط: تأكد إن `?action=get_employees` و`GET /logs` (بفلتر orderId معروف)
> بيرجّعوا نفس النتائج اللي كانت شغالة قبل النقل.

## فخاخ الأداة دي

- الكود بيستخدم اسم داخلي مختلف عن اسم الريبو (شوف الملحوظة أعلى الملف).
- 🔴 **عمود `timestamp` فيه صيغتين، والتانية دائمة.** من v2.2.0 الكتابة UTC ISO،
  بس **٩٤,٣٧٤ صف تاريخي** (قياس 12-09-2026) لسه بصيغة `YYYY-MM-DD - HH:MM:SS`
  **بتوقيت القاهرة** (UTC+3). أي كود بيقرا العمود ده لازم يفهم الشكلين —
  `tsToCairoParts()` في `index.html` هي النسخة المعتمدة. **وممنوع تحويل
  الصيغة القديمة** — هي أصلاً قاهرة، والتحويل عليها بيطلّع رقم غلط بـ٣ ساعات
  **وبيبان سليم**.
- `POST /log` مفيهوش idempotency، والـ Flow معمول له Retry على 5XX — شوف
  "مسائل مفتوحة".

## استرجاع النسخ القديمة

> ده بديل الـ tags — دفع الـ tags ممنوع من جلسات Claude Code السحابية.

```
النسخ المرقّمة القديمة محفوظة في commit: b4a0cb5
git show b4a0cb5:Index.html      # الواجهة القديمة (قبل ما تتحوّل لصفحة تحويل)
git show b4a0cb5:2.0..0.html     # نسخة أقدم محفوظة باسم مرقّم
```

## بصمة المهارات

| المهارة | الإصدار وقت آخر تعديل |
|---|---|
| ecommoda-worker-builder | v3.0.0 |
| ecommoda-html-builder | v7.0.0 |
| ecommoda-constants | v2.2.0 |

آخر مطابقة: 12-09-2026 · `index.js` v2.2.0 · `index.html` v2.1.0
🔴 معلّقة: بنود مؤجّلة لـ **PR منفصل** بقرار صريح 12-09-2026 (التسليم ده مقصور
على إصلاح الكاتب — خطوة ١ في وثيقة `D1 logs timestamp` 04-09-2026):
- `worker-builder` ⑨ — `?action=diag` و`?action=get_config` مش موجودين
- `worker-builder` Step 6/Log-Model v2 — `get_logs_count` · `get_logs_export`
  (+ `cap`/`total`/`truncated`) مش موجودين، و`GET /logs` بيقصّ عند ٥٠٠ وبيرجّع
  `total` = عدد الصفحة (رقم مضلّل)
- `worker-builder` Step 3 — CORS لسه wildcard `*` مع وجود `DELETE`
- `html-builder` #28 — `LS_URL`/`LS_ADMIN_URL` لسه في `localStorage` وفي الإعدادات
- `html-builder` #29 — مفيش `MIN_WORKER_VERSION` ولا `cmpVersion()` ولا حارس نسخة
- `html-builder` #15/#24 — مفيش `TOOL_VERSION` موحّد ولا `#loginVersionText`
- `html-builder` #16/#35/#36/#41 — `IBM Plex Mono` لسه محمّل · ١٧ hex حرفي خارج
  `:root` · ١١ توكن ناقص · `.toast-warning` غير معرّف
- `html-builder` #17/#19–#26 — `--container-max: 960px` (مش من الـ Tiers) ومعيار
  الجداول الموحّد مش مطبّق (فلتر `<select>` قيمة واحدة · بلا ترتيب · بلا chips)
- `html-builder` #34 — إرشاد اختيار الموظف لسه مكرر في ٤ أماكن
- `html-builder` H-7 — `apiRequest` بلا مهلة، و`loadLogs`/`deleteEntry` بينادوا
  `fetch()` مباشرة
- معيار §MD — `README.md` و`CLAUDE.md` بلا غلاف RTL ولا بادج نسخة ولا فوتر

## مسائل مفتوحة

### ✅ اتقفل في v2.2.0 (12-09-2026)

- **`import_logs` endpoint اتشال بالكامل** — `ecommoda-constants` §11 بند 13.
  البند اتقفل **بالحذف** مش بتأكيد نجاح الترحيل (قرار أحمد 12-09-2026، مطابق
  لتوصية وثيقة `D1 logs timestamp` 04-09-2026). كان مفيهوش idempotency
  والأخطاء الفردية بتتبلع بـ`.catch(() => {})` — نفس الـ endpoint في
  `cod-payment-center-worker` كتب ٩٢٥ صف مكرر بـ١.٨ مليون جنيه وهمية.
- **الإزاحة الثابتة `+3h` اتشالت** من الـ Worker والواجهة — `constants §13`.
  الأداة **خرجت من نطاق** بند التوقيت ومش محتاجة أي تدخل يوم 29-10-2026.
- **حارس `WORKER_SECRET` الغايب** اتضاف — `worker-builder` Step 8.

### 🔴 خطوات باقية في مسار إصلاح الوقت

الوثيقة المرجعية: `D1 logs timestamp and source key 04-09-2026`.

1. **الـ Flow لسه محتاج تعديل يدوي** (بره الريبو ده):
   ```diff
   - "flowTimestamp": "{{order.updatedAt | date: '%s' | plus: 7200 | date: '%Y-%m-%d - %H:%M:%S'}}"
   + "flowTimestamp": "{{order.updatedAt}}"
   ```
   Shopify Admin → Flow → `Order-Status-History - Metafields change log > Worker`
   → `Send HTTP request` → Body، وبعدها **Apply changes** (الـ workflow بيقعد
   `Draft` لحد ما تضغطه).
   **يتعمل بعد نشر v2.2.0** — الواجهة بتفهم الصيغتين فمفيش كسر، بس الترتيب
   بيخلّي التحقق أوضح.
   **تحقق:** صف جديد المفروض `flowTimestamp ≈ timestamp` بفرق ثواني
   (كانت الفجوة **ساعة ثابتة**: الـ Flow `+2` والـ Worker `+3`).

2. **backfill الكتلة B** — ٧٤,٠٨٨ صف (قياس 12-09-2026)، إزاحة **+3 مثبتة من
   ٣ مصادر مستقلة**. نسخة احتياطية → `SELECT` على عيّنة → `UPDATE` على دفعات.
   ⚠️ **مش كفاية تحط `T` مكان الشرطة — لازم كمان تطرح ٣ ساعات.** لو اتعمل `T`
   وبس، الأرقام تبقى مقروءة و**غلط بـ٣ ساعات**، وده **أسوأ** من المكسور لأن
   المكسور بيبان مكسور.
   الاستعلامات الجاهزة في الوثيقة §١.٨ خطوة ٢.

3. **الكتلة A — ٢٠,٢٨٦ صف (11-04 → 06-05-2026) — معلّقة بقرار.**
   إزاحتها **غير مثبتة**: إما UTC+2 (لو الـ Worker اتغيّر يوم ٦ مايو) أو UTC+3
   (لو الـ Flow هو اللي اتغيّر). الاتنين بينتجوا نفس القياس من D1.
   **الحسم محتاج Cloudflare Dashboard → Deployments → Version History حوالين
   06-05-2026** — مش متاح عبر MCP (اتجرّب 12-09-2026: الأدوات بترجّع الـ Worker
   الحالي وكوده بس). البديل: تاريخ تعديل الـ Flow من Shopify Admin.
   🔴 **ممنوع backfill للكتلة A قبل الحسم** — بالإزاحة الغلط تبقى ٢٠,٢٨٦ صف
   غلط بساعة، **وهتبان سليمة تمامًا ومحدش هيكتشفها**.
   مش مستعجل: أبريل–مايو، بره أي KPI حي، وصيغتها المكسورة بتترتّب قبل كل ISO
   وهي فعلًا أقدم — فالترتيب مش متأثر.

4. **`extra.flowTimestamp` / `extra.workerTimestamp` التاريخية تتساب زي ما هي**
   (قرار أحمد 12-09-2026) — أثر تاريخي، مش بيتصلّح في الـ backfill. والشكل
   نفسه اتساب في v2.2.0 للتوافق مع `handleGetLogs`، فـ`workerTimestamp` بقى
   نسخة من عمود `timestamp`.

### 🟠 مسار تكرار في `POST /log` — مكتشف 12-09-2026

في `handleLog` الـ `INSERT` بيحصل، وبعده `SELECT last_insert_rowid()`. لو
التانية رمت، الـ catch بيرجّع **500** — **والصف اتكتب فعلاً**. والـ Flow معمول
له **Retry على 5XX** → **صف مكرر**. مفيش أي idempotency على الـ endpoint ده.
المسار ضيّق بس حقيقي، ونفس عيلة الفشل بتاعة الـ٩٢٥ صف.
**الإصلاح المقترح (PR منفصل):** مفتاح idempotency من
`(orderId, metafieldKey, flowTimestamp)` أو نقل `last_insert_rowid()` جوه
try/catch مستقل ما يحوّلش نجاح الكتابة لـ500.

**وبنفس المناسبة:** `Retry` على **4XX** في الـ Flow تتقفل — الـ Worker بيرجّع
`400` على حقل ناقص أو key مش مسموح، و`401` على Unauthorized. ولا واحدة منهم
بتبقى ٢٠٠ مهما اتكرّرت.

### 🟠 قديمة — لم تُراجَع

- CORS wildcard (`*`) — منقول كما هو من الكود الأصلي، ومع وجود `DELETE` القاعدة
  بتقول Option B (allowlist). مؤجّل للـ PR التاني.
- `DELETE /log` و`DELETE /logs/order` بيمسحوا من D1 **بلا أي `writeLog`** —
  مفيش اسم موظف ولا سبب ولا أثر. مفيش طريقة تعرف مين مسح إيه.

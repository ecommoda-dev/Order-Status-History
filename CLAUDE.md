<div dir="rtl" style="text-align: right;">

# سجل تغييرات حالة الأوردر (`Order-Status-History`)

![version](https://img.shields.io/badge/version-v3.0.0-blue)

**بتعمل إيه:** تسجّل كل تغيير في حالة الأوردر (S1/S2/الدفع/الكوريير) في D1، وفيها شاشة دخول موظفين وجدول بحث بالفلاتر والترتيب والتصدير.
**مين بيستخدمها:** أي موظف محتاج يراجع تاريخ تغييرات حالة أوردر معيّن.
**الإصدار:** Worker `v2.3.0` · الواجهة `v3.0.0`

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
| `verify_employee` | تسجيل الدخول (PIN) — بيرجّع `logged` كمان |
| `log_logout` | تسجيل خروج |
| `get_employees` | قائمة الموظفين الفعّالين |
| `get_config` | نسخة الـ Worker — مصدر حارس النسخة في الواجهة |
| `diag` | فحص ذاتي بلا أي كتابة — **مابيرجّعش قيمة أي سر** |
| `get_logs` | صفحة واحدة (١٠٠ صف) — فلترة وترتيب server-side |
| `get_logs_count` | العدد الكلي المطابق للفلاتر — مصدر رقم «النتائج» |
| `get_logs_export` | كل المطابق حتى السقف + `cap` · `total` · `truncated` |
| `get_filter_options` | قيم الفلاتر الموجودة فعلاً في البيانات |
| `POST /log` | نقطة دخول Shopify Flow — تسجيل تغيير جديد |
| `GET /logs` | مسار قديم متساب للتوافق (لازم فلتر واحد على الأقل) |
| `DELETE /log` | حذف صف واحد بالـ id |
| `DELETE /logs/order` | حذف كل صفوف أوردر معيّن |

**فلاتر الـ log endpoints التلاتة (نفس المجموعة بالظبط):**
`keys=a,b` · `values=x,y` · `orders=#1780,567…` · `search` · `dateFrom` · `dateTo`
و`sortBy`/`sortDir` على `get_logs` **بس** (العدّ مالوش ترتيب، والتصدير بياخد ترتيب السيرفر).

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

`Access-Control-Allow-Origin` بقى **allowlist** من v2.3.0 (`ALLOWED_ORIGINS`)
بدل الـ wildcard — الأداة فيها `DELETE`.

> ✅ **Shopify Flow مش متأثر**: بينادي من السيرفر بلا `Origin` header،
> والـ CORS حماية متصفح بس. اللي محتاج الـ allowlist هو صفحة GitHub Pages.

## فخاخ الأداة دي

- الكود بيستخدم اسم داخلي مختلف عن اسم الريبو (شوف الملحوظة أعلى الملف).
- 🔴 **عمود `timestamp` فيه صيغتين، والتانية دائمة.** من v2.2.0 الكتابة UTC ISO،
  بس الصفوف التاريخية لسه بصيغة `YYYY-MM-DD - HH:MM:SS` **بتوقيت القاهرة**
  (UTC+3). أي كود بيقرا العمود ده لازم يفهم الشكلين — `tsToCairoParts()` في
  `index.html` هي النسخة المعتمدة. **وممنوع تحويل الصيغة القديمة** — هي أصلاً
  قاهرة، والتحويل عليها بيطلّع رقم غلط بـ٣ ساعات **وبيبان سليم**.
  `?action=diag` بيعدّ الصفوف القديمة، فتقدر تتابع تقدّم الـ backfill منه.
- 🔴 **`extra.flowTimestamp` مش بتوقيت القاهرة** في الصفوف التاريخية — الـ Flow
  كان بيكتبه بـ UTC+2 والقاهرة +3. **الواجهة بتعرض عمود `timestamp` مش
  `flowTimestamp`** عشان كده. لو حد رجّع العرض للحقل ده، كل الأوقات هترجع
  ناقصة ساعة **من غير أي إشارة**.
- `POST /log` مفيهوش idempotency، والـ Flow معمول له Retry على 5XX — نافذة
  التكرار الرئيسية اتقفلت في v2.3.0 (`meta.last_row_id` بدل استعلام تاني)،
  بس الـ endpoint نفسه لسه مش idempotent.
- `DELETE` بلا أي `writeLog` — شوف "مسائل مفتوحة".

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

آخر مطابقة: 17-09-2026 · `index.js` v2.3.0 · `index.html` v3.0.0
🔴 معلّقة: بند واحد — **تسجيل السجل على الحذف** (تحت في "مسائل مفتوحة")، متوقّف
على تسجيل قيمة `type` جديدة في `ecommoda-constants` §7. باقي بنود المعايير
اتقفلت كلها في التسليم ده.

## مسائل مفتوحة

### ✅ اتقفل في v2.2.0 + v2.3.0 / الواجهة v3.0.0

- **`import_logs` endpoint اتشال بالكامل** — `ecommoda-constants` §11 بند 13.
  البند اتقفل **بالحذف** مش بتأكيد نجاح الترحيل (قرار أحمد 12-09-2026).
- **الإزاحة الثابتة `+3h` اتشالت** من الـ Worker والواجهة — `constants §13`.
  الأداة **خرجت من نطاق** بند التوقيت ومش محتاجة أي تدخل يوم 29-10-2026.
- **حارس `WORKER_SECRET` الغايب** اتضاف — `worker-builder` Step 8.
- **نافذة التكرار في `POST /log`** — الـ id بقى من `meta.last_row_id` بدل
  استعلام تاني كان ممكن يرجّع 500 بعد كتابة ناجحة فالـ Flow يعيد.
- **`GET /logs` كان بيكدب في `total`** — كان بيرجّع عدد صفوف الصفحة (٥٠٠ كحد
  أقصى) كأنه الإجمالي. بقى العدّ الحقيقي ومعاه `truncated`.
- **`diag` و`get_config`** اتضافوا · **CORS** بقى allowlist.
- **نموذج السجل v2** — `get_logs` · `get_logs_count` · `get_logs_export`
  (+ `cap`/`total`/`truncated`) · `get_filter_options`.
- **الواجهة:** معيار الجداول الموحّد كامل · حارس نسخة الـ Worker ·
  `TOOL_VERSION` من مصدر واحد · `apiRequest` بمهلة · الروابط بقت constants ·
  الطبقة البصرية (توكنز + التوست الأربعة + Tier M) · إرشاد الدخول مرة واحدة.
- **الوقت المعروض كان ناقص ساعة** — الجدول كان بيعرض `flowTimestamp` (UTC+2).
  بقى بيعرض عمود `timestamp` (UTC ISO → القاهرة). **اتصلّح بدون أي كتابة على D1.**
- **معيار §MD** على `README.md` و`CLAUDE.md`.

### 🔴 محتاج تدخل منك — مش شغل كود

1. **تعديل الـ Flow** (بره الريبو):
   ```diff
   - "flowTimestamp": "{{order.updatedAt | date: '%s' | plus: 7200 | date: '%Y-%m-%d - %H:%M:%S'}}"
   + "flowTimestamp": "{{order.updatedAt}}"
   ```
   Shopify Admin → Flow → `Order-Status-History - Metafields change log > Worker`
   → `Send HTTP request` → Body، وبعدها **Apply changes** (الـ workflow بيقعد
   `Draft` لحد ما تضغطه). **وبنفس المناسبة: اقفل Retry على 4XX** — الـ Worker
   بيرجّع `400` على حقل ناقص أو key مش مسموح و`401` على Unauthorized، ولا
   واحدة منهم بتبقى ٢٠٠ مهما اتكرّرت.
   **تحقق:** صف جديد المفروض `flowTimestamp ≈ timestamp` بفرق ثواني (كانت
   الفجوة **ساعة ثابتة**).

2. **تسجيل `type` جديد في `ecommoda-constants` §7** عشان الحذف يتسجّل — شوف
   البند اللي تحت.

3. **backfill الكتلة B** — ٧٤,٠٨٨ صف (قياس 12-09-2026)، إزاحة **+3 مثبتة من
   ٣ مصادر مستقلة**. نسخة احتياطية → `SELECT` على عيّنة → `UPDATE` على دفعات.
   ⚠️ **مش كفاية تحط `T` مكان الشرطة — لازم كمان تطرح ٣ ساعات.** الاستعلامات
   في وثيقة `D1 logs timestamp` §١.٨.
   ℹ️ **مش مستعجل، والشاشة مش هتتأثر:** اتأكد إن الصيغة القديمة والـ ISO
   المقابلة ليها بيعرضوا **نفس النتيجة بالظبط**. مكسب الـ backfill في
   **الاستعلامات** (`ORDER BY` و`new Date()`)، مش في الواجهة.

### 🟠 الحذف بلا أي أثر — البند الوحيد المتبقّي في الكود

`DELETE /log` و`DELETE /logs/order` بيمسحوا من D1 بـ **صفر `writeLog`** —
مفيش اسم موظف ولا سبب ولا أثر. لو صف اتمسح بالغلط مفيش طريقة تعرف مين ولا امتى.

🔴 **متوقّف على قاعدة مش على وقت:** `worker-builder` Rule 7 بيقول أي قيمة `type`
جديدة لازم تتسجّل في `ecommoda-constants` §7 **قبل** أول `writeLog`، مش بعده.
الأداة مسجّل ليها `update · rejected · login · logout` بس، ومفيش فيهم قيمة
تعبّر عن حذف.

**خطوات التنفيذ بالترتيب:**
1. سجّل `delete_log` (أو الاسم اللي تختاره) في `ecommoda-constants` §7 تحت صف
   `metafields_change`.
2. الـ Worker: `writeLog` في `handleDelete` و`handleDeleteOrder` بالـ type ده
   + `employee` + `orderName` + عدد الصفوف المحذوفة في `extra`.
3. الواجهة: تبعت `employee` مع نداء الحذف (دلوقتي مش بتبعته أصلاً).

### 🟢 الكتلة A — قرار: تتساب، مش بند مفتوح

٢٠٬٢٨٦ صف (11-04 → 06-05-2026) بالصيغة القديمة، **إزاحتها غير مثبتة** — إما
UTC+2 (لو الـ Worker اتغيّر يوم ٦ مايو) أو UTC+3 (لو الـ Flow هو اللي اتغيّر).
الاتنين بينتجوا نفس القياس من D1، والحسم محتاج Version History لكلاودفلير
حوالين 06-05-2026 (**مش متاح عبر MCP** — اتجرّب 12-09-2026).

**القرار (17-09-2026): تتساب بصيغتها ومايتعملهاش backfill.**

| السبب | التفاصيل |
|---|---|
| المكسب صفر عمليًا | أبريل–مايو، بره أي KPI حي |
| الترتيب **مش متأثر** | صيغتها المكسورة بتخليها تترتّب قبل كل ISO — وهي فعلًا أقدم، فالنتيجة صح |
| المخاطرة غير متماثلة | الإزاحة الغلط = ٢٠ ألف صف غلط بساعة **وشكلهم سليم**. الوضع الحالي على الأقل **بيبان مكسور** |
| العرض شغّال | `tsToCairoParts()` بتعرضها صح زي ما هي |

🔴 **ممنوع backfill للكتلة A** من غير حسم الإزاحة من مصدر خارج D1.

آخر تحديث: 17-09-2026 — 16:30

</div>

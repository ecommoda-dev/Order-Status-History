# سجل تغييرات حالة الأوردر (`Order-Status-History`)

**بتعمل إيه:** تسجّل كل تغيير في حالة الأوردر (S1/S2/الدفع/الكوريير) في D1، وفيها شاشة دخول موظفين وسجل بحث بالأوردر/الحالة/التاريخ.
**مين بيستخدمها:** أي موظف محتاج يراجع تاريخ تغييرات حالة أوردر معيّن.
**الإصدار:** Worker `v2.1.0` · الواجهة `v2.1.0`

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
| `import_logs` | ⚠️ **مؤقت للـ Migration القديمة** — راجع "مسائل مفتوحة" تحت |
| `POST /log` | تسجيل تغيير حالة جديد |
| `GET /logs` | البحث في السجل (لازم فلتر واحد على الأقل: orderId/metafieldKey/date) |
| `DELETE /log` | حذف صف واحد بالـ id |
| `DELETE /logs/order` | حذف كل صفوف أوردر معيّن |

## D1

```
tool  : metafields_change
type  : update · login · logout
```

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
- `import_logs` endpoint مؤقت وخطير لو اتشغّل تاني من غير idempotency — لا تستدعيه.

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
| ecommoda-worker-builder | v2.0.0 |
| ecommoda-html-builder | v6.3.0 |
| ecommoda-constants | v1.4.4 |

آخر مطابقة: 05-09-2026 · `index.js` v2.1.0 · `index.html` v2.1.0
🔴 معلّقة: — لا شيء

## مسائل مفتوحة

- **`import_logs` endpoint لسه منشور ومنتظر تأكيد أحمد** (موثّق في
  `ecommoda-constants` §11 بند 13). الكود نفسه معلَّم "مؤقت للـ Migration —
  يُحذف فور التحقق من نجاح الـ Migration". النقل الحالي (لريبو Git) نقل الكود
  **حرفيًا زي ما هو** بدون حذف الـ endpoint — الحذف قرار منفصل يحتاج تأكيد
  إن الـ Migration القديمة (استيراد سجلات) خلصت، ثم PR منفصل يحذفه وينشر فورًا
  (نفس النمط اللي سبّب ٩٢٥ صف مكرر في أداة تانية لو اتشغّل تاني بدون idempotency).
- CORS wildcard (`*`) — لم يُراجَع كجزء من هذا النقل، منقول كما هو من الكود الأصلي.

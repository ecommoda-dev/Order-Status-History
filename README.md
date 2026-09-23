<div dir="rtl" style="text-align: right;">

# Order Status History

![version](https://img.shields.io/badge/version-v2.0.0-blue)

أداة EcomModa الداخلية لتسجيل ومراجعة تاريخ تغييرات حالة الأوردر
(S1 / S2 / الدفع / الكوريير).

## الروابط

- **الواجهة:** GitHub Pages — <https://ecommoda-dev.github.io/Order-Status-History/>
- **الـ API:** Cloudflare Worker — `order-status-history-worker`

## إيه اللي جوّه

| الملف | بيعمل إيه |
|---|---|
| `index.js` | الـ Cloudflare Worker — Auth · تسجيل التغييرات · endpoints السجل |
| `index.html` | الواجهة — شاشة دخول + جدول موحّد بفلاتر وترتيب وصفحات وتصدير |
| ~~`Index.html`~~ | اتشالت — 23-09-2026، قرار أحمد. الرابط الوحيد: `https://ecommoda-dev.github.io/Order-Status-History/` |
| `wrangler.toml` | إعداد النشر + ربط D1 |

## البداية

التغييرات بتوصل من **Shopify Flow** على `POST /log`، والـ Worker بيسجّلها في
D1 تحت `tool = 'metafields_change'` بوقت **UTC ISO**. الواجهة بتقرا السجل
وبتعرضه بتوقيت القاهرة.

⚠️ راجع `CLAUDE.md` قبل أي تعديل — فيه الـ endpoints، وفخاخ الأداة
(أهمها إن عمود `timestamp` فيه صيغتين)، والمسائل المفتوحة.

آخر تحديث: 17-09-2026 — 16:30

</div>

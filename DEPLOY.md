# نشر مكتبة ديالا على Cloudflare

كل شي مجاني ضمن حدود الاستخدام العادية. الخطوات بتاخد حوالي 10 دقايق، مرة وحدة بس.

## 1) ربط الريبو
1. Cloudflare Dashboard ← **Workers & Pages** ← **Create** ← **Pages** ← **Connect to Git**.
2. اختر ريبو `dyala-library`.
3. الفرع: `main` (أو `build/v1` قبل الدمج).
4. إعدادات البناء:
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
5. **Save and Deploy**. أول نشر رح يشتغل، بس الموقع ما رح يدخل لحد ما تكمل الخطوات 2 و3.

## 2) قاعدة البيانات والتخزين
- **D1:** Storage & databases ← D1 ← Create database. الاسم: `dyala-db`.
- **R2:** Storage & databases ← R2 ← Create bucket. الاسم: `dyala-books`.
  - ملاحظة: Cloudflare بيطلب بطاقة دفع لتفعيل R2 حتى لو بالخطة المجانية (10 GB مجاناً). ما بيسحب منك إلا إذا تعدّيت الحد.

## 3) الربط والأسرار (Pages ← Settings)
**Bindings** (Settings ← Bindings ← Add):

| النوع | الاسم (لازم يكون بالضبط) | القيمة |
|---|---|---|
| D1 database | `DB` | `dyala-db` |
| R2 bucket | `BOOKS` | `dyala-books` |

**Variables and Secrets** (نوع Secret لكل وحدة):

| الاسم | شو تحط |
|---|---|
| `ADMIN_PASSWORD` | كلمة سرك (حساب `ahmed`) |
| `DYALA_PASSWORD` | كلمة سر ديالا المبدئية (حساب `dyala`)، وهي بتغيّرها من القائمة |

بعدها: Deployments ← آخر نشر ← **Retry deployment**.

> كلمات السر بتتحول لـ hash عند أول فتح للموقع. بعدها تغييرها بالـ Secrets ما بيأثر؛ التغيير من داخل التطبيق (القائمة ← تغيير كلمة السر).

## 4) الاستخدام
- أنت: افتح الموقع ← `ahmed` وكلمة السر ← لوحة الإدارة ← ارفع الكتب (بتنرفع على مكتبة ديالا).
- ديالا: `dyala` وكلمتها. على الآيفون: Safari ← مشاركة ← **Add to Home Screen**.
- أول فتح لكل كتاب بينزل على الجهاز (مرة وحدة) وبعدها بيشتغل بدون إنترنت.

## تشغيل محلي للتجربة
```
npm install
npm run dev        # http://localhost:8788 ، حساب ahmed / admin-pass-123 وحساب dyala / dyala-pass-123
```
بيانات التجربة بتنحفظ بمجلد `.dev-data` (غير مرفوع على GitHub).

## AI (اسأل AI)

Add one more Pages secret: `ANTHROPIC_API_KEY` (Settings → Variables and secrets → Add → Secret), then redeploy.
Optional: `AI_MODEL` (default `claude-sonnet-5-5`). Daily limit per user: 80 (admin 300), see `server/app.ts`.
Local test without a key: `MOCK_AI=1 npx tsx dev/dev-server.ts`.

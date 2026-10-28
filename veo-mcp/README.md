# 🎬 Video MCP Server (Gemini Omni)

Claude uchun remote MCP server (Streamable HTTP). U Google **Gemini Omni** (ovozli va dialogli video) modelini Gemini **Interactions API** orqali ishlatib video yaratadi.

> Google Veo 3.1 preview modellarini o'chirdi (`veo-3.1-*-preview` endi 404 qaytaradi), shuning uchun server `gemini-omni-1.1-flash` modeliga o'tkazildi. Connector nomi va URL o'zgarmadi.

**Vositalar (tools):**

| Tool | Vazifasi |
|---|---|
| `generate_video` | `prompt`, `aspect_ratio` (`9:16` standart yoki `16:9`), `model` (ixtiyoriy), `negative_prompt` (ixtiyoriy). Generatsiyani boshlaydi va darhol `operation_id` qaytaradi. |
| `check_video_status` | `operation_id` bo'yicha holatni tekshiradi. Video tayyor bo'lsa, uni serverga yuklab oladi va `https://.../videos/<id>.mp4` havolasini qaytaradi. Xato yoki xavfsizlik bloki bo'lsa, aniq sababini aytadi. |
| `list_videos` | Oxirgi videolar ro'yxati: havola, prompt va holat. |

**Modellar:** `gemini-omni-1.1-flash` (standart), `gemini-omni-flash-preview`. `model` maydoniga istalgan model nomini yozish mumkin — u API'ga o'zgarishsiz yuboriladi, nom xato bo'lsa API xatosi qaytariladi. Standart modelni `DEFAULT_VIDEO_MODEL` o'zgaruvchisi bilan almashtirish mumkin. `negative_prompt` uchun alohida maydon yo'q, shuning uchun u prompt oxiriga "Do not include: …" ko'rinishida qo'shiladi. Davomiylik standart 8 soniya (`VIDEO_DURATION_SECONDS`).

Bosh sahifa (`/`) server holatini va barcha videolarni play tugmasi bilan ko'rsatadi. Videolar 7 kundan keyin avtomatik o'chiriladi.

---

## 1. Gemini API kalitini olish

1. https://aistudio.google.com saytiga Google akkauntingiz bilan kiring.
2. Chap menyuda **Get API key** (yoki to'g'ridan-to'g'ri https://aistudio.google.com/apikey) → **Create API key** tugmasini bosing.
3. Loyiha (Google Cloud project) tanlang yoki yangisini yarating, kalitni nusxalang (`AIza...` bilan boshlanadi).
4. ⚠️ **Video yaratish pullik.** Bepul (Free Tier) kalitda `gemini-omni-1.1-flash` limiti kuniga 0 ta so'rov, ya'ni u ishlamaydi — xuddi shu loyiha uchun **billing**ni yoqing: AI Studio → API key yonidagi **Set up billing** (yoki Google Cloud Console → Billing). Narxlar sekundiga hisoblanadi, hozirgi narxni https://ai.google.dev/gemini-api/docs/pricing sahifasidan tekshiring. 

## 2. Environment o'zgaruvchilari

| O'zgaruvchi | Majburiy | Tavsif |
|---|---|---|
| `GEMINI_API_KEY` | ha | 1-bosqichda olingan kalit. |
| `ACCESS_TOKEN` | ha | Kamida 16 belgili tasodifiy maxfiy satr. U URL ichida bo'lmagan har qanday MCP so'rov rad etiladi. |
| `PUBLIC_BASE_URL` | yo'q* | Sayt manzili, masalan `https://veo-mcp.onrender.com`. *Render va Railway'da avtomatik aniqlanadi, lekin aniq yozib qo'ygan ma'qul. |
| `DEFAULT_VIDEO_MODEL` | yo'q | Standart model (default: `gemini-omni-1.1-flash`). |
| `VIDEO_DURATION_SECONDS` | yo'q | Video davomiyligi soniyalarda (default: 8). |
| `RETENTION_DAYS` | yo'q | Videolar necha kun saqlanadi (default: 7). |
| `DATA_DIR` | yo'q | Videolar va bazani saqlash papkasi (default: `./data`). |

`ACCESS_TOKEN` yaratish (faqat harf va raqamlardan iborat bo'lsin — `/` yoki `+` belgilari bo'lmasin):

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

## 3. Lokal ishga tushirish va MCP Inspector bilan tekshirish

```bash
cd veo-mcp
npm install
npm run build
GEMINI_API_KEY=AIza... ACCESS_TOKEN=sizning_tokeningiz npm start
```

Boshqa terminalda:

```bash
npx @modelcontextprotocol/inspector
```

Inspector oynasida: **Transport Type** = `Streamable HTTP`, **URL** = `http://localhost:3000/mcp/sizning_tokeningiz` → **Connect** → **Tools** → `generate_video`.

Yoki CLI rejimida:

```bash
npx @modelcontextprotocol/inspector --cli http://localhost:3000/mcp/sizning_tokeningiz --transport http --method tools/list
npx @modelcontextprotocol/inspector --cli http://localhost:3000/mcp/sizning_tokeningiz --transport http \
  --method tools/call --tool-name generate_video --tool-arg prompt="A cat surfing a wave at sunset, cinematic"
```

## 4. Deploy

Avval kodni GitHub'ga yuklang (bu repo allaqachon GitHub'da bo'lsa, shart emas).

### Variant A — Render (bepul)

1. https://render.com → GitHub bilan kiring.
2. **New +** → **Blueprint** → shu repozitoriyani tanlang. Render ildizdagi `render.yaml` faylini o'qiydi va `veo-mcp` servisini yaratadi.
   (Yoki qo'lda: **New +** → **Web Service** → repo → **Root Directory** = `veo-mcp`, **Runtime** = `Docker`, **Instance Type** = `Free`.)
3. **Environment** bo'limida `GEMINI_API_KEY` va `ACCESS_TOKEN` qiymatlarini kiriting. Ixtiyoriy: `PUBLIC_BASE_URL` = `https://<servis-nomi>.onrender.com`.
4. **Deploy** tugmasini bosing. Tugagach, `https://<servis-nomi>.onrender.com/` ni oching — "Server ishlayapti" yozuvi chiqishi kerak.

⚠️ Render free rejimi haqida: servis 15 daqiqa so'rov bo'lmasa "uxlaydi" (keyingi birinchi so'rov ~1 daqiqa kechikadi) va bepul tarifda **disk vaqtinchalik** — servis uxlaganda yoki qayta deploy qilinganda saqlangan videolar o'chib ketadi. Videoni tayyor bo'lishi bilan yuklab oling. Videolar doimiy saqlanishi kerak bo'lsa, Render'da pullik **Disk** qo'shing (mount path: `/app/data`) yoki Railway'dagi Volume'dan foydalaning.

### Variant B — Railway

1. https://railway.com → GitHub bilan kiring → **New Project** → **Deploy from GitHub repo** → shu repo.
2. Servis sozlamalarida **Settings → Root Directory** = `veo-mcp` (Railway `Dockerfile` va `railway.json` ni o'zi topadi).
3. **Variables** bo'limiga `GEMINI_API_KEY`, `ACCESS_TOKEN` qo'shing.
4. **Settings → Networking → Generate Domain** — sizga `https://<nom>.up.railway.app` beriladi. Uni `PUBLIC_BASE_URL` sifatida ham qo'shing.
5. Videolar saqlanib qolishi uchun: servisga o'ng tugma → **Attach Volume**, mount path `/app/data`.

Railway'da yangi akkauntga bepul sinov krediti beriladi, keyin oyiga kichik to'lov talab qilinadi.

## 5. Claude'ga connector qo'shish

Yakuniy connector URL:

```
https://<sizning-domeningiz>/mcp/<ACCESS_TOKEN>
```

Masalan: `https://veo-mcp.onrender.com/mcp/3f9c1a...e7`

1. Claude → **Settings** → **Connectors** → **Add custom connector**.
2. **Name**: `Veo Video`, **Remote MCP server URL**: yuqoridagi URL. OAuth maydonlarini bo'sh qoldiring.
3. **Add** → yangi chatda connector yoqilganini tekshiring va yozing:
   *"Tog'lar ustida uchayotgan burgut haqida 9:16 video yarat"*.
   Claude `generate_video` ni chaqiradi, so'ng `check_video_status` bilan tayyor bo'lishini kutadi va havolani beradi.

🔒 Connector URL'ni hech kimga bermang — unda maxfiy token bor. Token oshkor bo'lsa, `ACCESS_TOKEN` ni almashtirib, connector'ni yangi URL bilan qayta qo'shing. Bosh sahifa va `/videos/` havolalari ochiq (tokensiz) ishlaydi.

## Xatolar

Server Gemini xatolarini tushunarli xabarga aylantiradi:

- **INVALID API KEY** — kalit noto'g'ri yoki o'chirilgan.
- **BILLING NOT ENABLED** — loyihada billing yoqilmagan (video yaratish faqat pullik tarifda; Free Tier limiti 0).
- **QUOTA EXCEEDED** — limit tugagan, biroz kuting. Birinchi so'rovdayoq chiqsa — kalit Free Tier'da, billingni yoqing.
- **BLOCKED BY SAFETY FILTERS** — prompt yoki natija Google xavfsizlik filtridan o'tmadi; Google bergan sabab ham ko'rsatiladi.
- **MODEL NOT FOUND / PERMISSION DENIED** — model nomi xato yoki kalitingizga bu model ruxsat etilmagan.

Server jarayondagi videolarni har 20 soniyada o'zi tekshirib, tayyor bo'lishi bilan yuklab oladi.

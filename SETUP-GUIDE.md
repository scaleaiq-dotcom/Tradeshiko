# 🚀 TradeSeekho — Go-Live Guide (Step by Step)

Total time: ~45 minutes. Sab kuch free hai. Bas follow karte jao.

**Files in this folder:**
- `index.html` — main app (Google login + cloud save + analytics built-in)
- `privacy.html` — Privacy Policy (DPDP Act 2023)
- `terms.html` — Terms & Conditions (educational disclaimer included)

---

## STEP 1: Firebase Project Banao (10 min)

1. Jao: **console.firebase.google.com** → Google account se login
2. **"Create a project"** → Name: `tradeseekho` → Continue
3. Google Analytics ka option aayega → **Enable rakho** (free analytics bonus!)
4. Project ban jaane ke baad, home screen pe **Web icon `</>`** pe click karo
5. App nickname: `TradeSeekho Web` → **Register app**
6. Ab ek **config object** dikhega — aisa:
   ```
   apiKey: "AIzaSy....."
   authDomain: "tradeseekho.firebaseapp.com"
   projectId: "tradeseekho"
   ...
   ```
7. **Yeh values copy karo** — Step 3 me chahiye hongi

## STEP 2: Google Login Enable Karo (3 min)

1. Firebase console me left menu → **Build → Authentication**
2. **Get started** → **Sign-in method** tab
3. **Google** pe click → **Enable** toggle ON
4. Support email select karo → **Save**

## STEP 3: Database Banao (5 min)

1. Left menu → **Build → Firestore Database** → **Create database**
2. Location: **asia-south1 (Mumbai)** — Indian users ke liye fastest
3. **Production mode** select karo → Create
4. **Rules** tab pe jao, sab delete karke yeh paste karo, phir **Publish**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

(Matlab: har user sirf apna data dekh/badal sakta hai. Secure. ✅)

## STEP 4: Google Analytics ID Lo (5 min)

1. Jao: **analytics.google.com**
2. Admin (⚙️) → **Create Property** → Name: `TradeSeekho` → India / INR
3. Platform: **Web** → Website URL: (abhi koi bhi, baad me update) → Create stream
4. **Measurement ID** copy karo — format: `G-XXXXXXXXXX`

*Note: Step 1 me Firebase Analytics enable kiya tha to property pehle se ban gayi hogi — usme se hi Measurement ID utha lo.*

## STEP 5: Apni IDs index.html Me Daalo (5 min)

1. `index.html` ko kisi bhi text editor me kholo (Notepad bhi chalega)
2. Upar hi `CONFIG` section milega:

```js
const CONFIG = {
  GA_ID: "G-XXXXXXXXXX",        // <-- Step 4 ka Measurement ID
  firebase: {
    apiKey: "YOUR_API_KEY",      // <-- Step 1 ki values
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
  }
};
```

3. Apni real values se replace karo → Save
4. **Important:** Jab tak values placeholder hain, app demo mode me chalti hai (login screen nahi dikhega). Values dalte hi login live ho jayega.

## STEP 6: Vercel Pe Deploy Karo (10 min)

**Option A — GitHub se (recommended, future updates easy):**
1. github.com pe new repository banao: `tradeseekho`
2. Teeno files upload karo (index.html, privacy.html, terms.html)
3. vercel.com → login with GitHub → **Add New Project** → repo import karo → **Deploy**
4. 1 minute me link milega: `tradeseekho.vercel.app` 🎉

**Option B — Vercel CLI se (GitHub nahi chahiye):**
```
npm i -g vercel
cd tradeseekho-folder
vercel
```
Login karo, sab questions pe Enter dabao. Done.

## STEP 7: ⚠️ SABSE IMPORTANT — Domain Authorize Karo

Login tabhi chalega jab Firebase ko apna domain pata ho:

1. Firebase console → **Authentication → Settings → Authorized domains**
2. **Add domain** → apna Vercel URL daalo (e.g. `tradeseekho.vercel.app`)
3. Save

**Yeh step bhoole to "unauthorized domain" error aayega login pe!**

## STEP 8: Test Checklist ✅

- [ ] Link kholo → login screen dikhe
- [ ] Google se login karo → "Account ban gaya! ₹1,00,000" toast aaye
- [ ] Koi stock buy karo → page refresh karo → portfolio wapas aa jaye (cloud save working!)
- [ ] Dusre phone se login karke check karo — alag account, alag portfolio
- [ ] Privacy/Terms links khul rahe hain footer me
- [ ] Share button WhatsApp khol raha hai
- [ ] analytics.google.com → Reports → Realtime → khud ko live user me dekho 📊

## STEP 9: Privacy Policy Me Email Daalo

`privacy.html` aur `terms.html` me `[apna support email yahan daalo]` ko apne real email se replace karo. (DPDP Act ke liye contact method zaroori hai.)

---

## 📊 Analytics Me Kya Dekhna (launch ke baad)

Google Analytics → Reports me:
- **Realtime** — abhi kitne log app pe hain
- **User acquisition** — log kahan se aa rahe (Instagram? WhatsApp?)
- **Events** — custom events jo app bhejti hai:
  - `login` — kitne logo ne account banaya
  - `trade_buy` / `trade_sell` — kitni trading activity (kaunsa stock bhi!)
  - `share_pnl` — kitne log share kar rahe (viral metric! 🔥)

Firebase console → Firestore → `users` collection me har user ka naam, email, portfolio dikhega — yahi tumhara user database hai.

---

## 🔜 Phase 2 (jab ready ho)

1. **Real NSE prices** — data API + ek chhota serverless function (Vercel pe hi)
2. **Leaderboard** — Firestore me hai hi sab data, bas ranking page banana hai
3. **Custom domain** — `trade.scaleaiq.com` Vercel me free me lag jata hai
4. **Premium tier** — Razorpay integration, ₹99/month

Koi bhi step pe atko to mujhe batao — saath me solve karenge! 💪

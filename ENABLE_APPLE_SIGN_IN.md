# 🍎 How to Enable Apple Sign In in Privy

## ❌ Current Error

```
Apple login error: [PrivyApiError: Login with Apple not allowed]
```

This means Apple Sign In is **not enabled** in your Privy Dashboard.

---

## ✅ Solution: Enable Apple in Privy Dashboard

### Step 1: Access Privy Dashboard

1. Go to: **https://dashboard.privy.io**
2. Sign in with your Privy account
3. Select your app: **App ID: `cmm22gaas01qw0djot7jeb7g4`**

### Step 2: Enable Apple Sign In

1. In the left sidebar, click **"Login Methods"** or **"Configuration"**
2. Look for **"Social Logins"** or **"OAuth Providers"**
3. Find **"Apple"** in the list
4. Click the **toggle switch** to enable it
5. Click **"Save"** or **"Update"**

### Step 3: Configure Apple (if required)

Privy may ask you to provide:

#### Required Information:
- **Bundle Identifier:** `com.memeswipe.mobile`
- **Apple Team ID:** (from Apple Developer Portal)
- **Service ID:** (optional, Privy may auto-generate)

#### Where to Find Apple Team ID:
1. Go to: https://developer.apple.com/account
2. Click **"Membership"** in the sidebar
3. Your **Team ID** is shown there (10 characters, e.g., `ABC1234DEF`)

### Step 4: Test

1. Restart your Expo app
2. Try Apple Sign In again
3. ✅ Should work now!

---

## 🔧 Temporary Workaround (Already Applied)

I've temporarily **commented out** the Apple Sign In button in your app so you can continue testing with Twitter.

### What I Changed:

1. **`apps/mobile/app/_layout.tsx`**
   - Removed `'apple'` from loginMethods
   - Only Twitter and Email are active now

2. **`apps/mobile/components/onboarding-screen.tsx`**
   - Commented out Apple Sign In button
   - Only Twitter button shows now

### Current User Flow:
```
Welcome to Swipeit

┌─────────────────────────┐
│  🐦 Sign in with Twitter│  ← Only this shows now
└─────────────────────────┘

Step 2: Verify Email
Step 3: Create Wallet
```

---

## 🚀 To Re-Enable Apple Sign In

### After you enable Apple in Privy Dashboard:

1. **Uncomment the Apple button** in `apps/mobile/components/onboarding-screen.tsx`
   - Remove the `/* */` comments around the Apple button code

2. **Add 'apple' back to loginMethods** in `apps/mobile/app/_layout.tsx`
   - Change: `loginMethods: ['twitter', 'email']`
   - To: `loginMethods: ['apple', 'twitter', 'email']`

3. **Restart the app**

---

## 📋 Privy Dashboard Checklist

When configuring Apple in Privy:

- [ ] Logged into Privy Dashboard
- [ ] Selected correct app (cmm22gaas01qw0djot7jeb7g4)
- [ ] Navigated to Login Methods
- [ ] Enabled Apple toggle
- [ ] Provided Bundle ID: com.memeswipe.mobile
- [ ] Provided Apple Team ID (if required)
- [ ] Saved changes
- [ ] Tested in app

---

## 🆘 Troubleshooting

### "Apple Team ID required"
- Go to https://developer.apple.com/account
- Click "Membership"
- Copy your Team ID

### "Bundle Identifier mismatch"
- Make sure you use: `com.memeswipe.mobile`
- This must match your app.json

### "Redirect URI error"
- Privy should auto-configure this
- If asked, use: Your app's deep link scheme

### Still not working?
- Check Privy documentation: https://docs.privy.io
- Contact Privy support
- Make sure you're on the correct Privy plan (Apple may require paid plan)

---

## 💡 Why This Happened

Apple Sign In requires:
1. ✅ Code implementation (we did this)
2. ✅ iOS capability in app.json (we did this)
3. ❌ **Privy Dashboard configuration** (needs to be done)
4. ❌ **Apple Developer Portal setup** (needs to be done)

We completed steps 1-2, but steps 3-4 need to be done in external dashboards.

---

## 📊 Current Status

| Item | Status |
|------|--------|
| Code Implementation | ✅ Done |
| iOS Capability | ✅ Done |
| Privy Dashboard | ❌ **Needs Configuration** |
| Apple Developer Portal | ❌ **Needs Configuration** |

---

## 🎯 Next Steps

### Option A: Enable Apple Sign In (Recommended for App Store)
1. Follow steps above to enable in Privy
2. Configure in Apple Developer Portal
3. Uncomment Apple button in code
4. Test and submit to App Store

### Option B: Submit Without Apple (Temporary)
1. Keep current code (Apple commented out)
2. Submit with only Twitter login
3. Add Apple in a future update

**Note:** Apple App Store **requires** Apple Sign In if you have other social logins. So Option A is required for approval.

---

## 📞 Need Help?

- **Privy Docs:** https://docs.privy.io/guide/react/wallets/external/apple
- **Privy Support:** support@privy.io
- **Apple Docs:** https://developer.apple.com/sign-in-with-apple/

---

## ✅ Summary

**Current State:**
- Apple Sign In is temporarily disabled
- Twitter login works
- App is functional

**To Enable Apple:**
1. Enable in Privy Dashboard
2. Configure in Apple Developer Portal
3. Uncomment code
4. Test

**For App Store Approval:**
- Apple Sign In is **required**
- Must be enabled before submission
- Follow steps above to enable

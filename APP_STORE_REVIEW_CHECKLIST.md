# Apple App Store Review - Potential Rejection Reasons

## ⚠️ HIGH RISK ISSUES

### 1. **Financial Trading / Cryptocurrency App (Guideline 3.1.5(b))**
**Risk Level: CRITICAL**

Your app facilitates cryptocurrency trading (meme tokens on Solana/Base). Apple has strict requirements:

**Issues Found:**
- Real money cryptocurrency trading without proper licensing
- No evidence of required financial services licenses
- Trading meme coins/tokens which are highly speculative
- In-app purchases for trading credits may violate IAP requirements

**Required Actions:**
- ✅ Add disclaimer: "Not financial advice. Trading involves risk of loss."
- ✅ Verify you have proper financial services licenses for your jurisdiction
- ✅ If using Stripe for payments, ensure compliance with Apple's IAP rules
- ✅ Consider implementing Apple's In-App Purchase for any virtual currency/credits
- ✅ Add age gate (18+ or 21+ depending on jurisdiction)

**Code References:**
- `apps/mobile/app/(tabs)/index.tsx` - Trading functionality
- `apps/api/.env` - Stripe integration (STRIPE_SECRET_KEY)

---

### 2. **Gambling-Like Mechanics (Guideline 5.3.2)**
**Risk Level: HIGH**

The swipe-to-trade mechanic resembles gambling:

**Issues Found:**
- Swipe right to "buy" tokens (similar to slot machines)
- "Trade memes, earn rewards" messaging suggests gambling
- Random token presentation in deck format
- Profit/loss tracking similar to betting apps

**Required Actions:**
- ✅ Remove "earn rewards" language from onboarding
- ✅ Add prominent risk warnings
- ✅ Ensure tokens are not presented randomly (show clear sorting/filtering)
- ✅ Add educational content about trading risks
- ✅ Implement age verification (18+)

**Code References:**
- `apps/mobile/components/onboarding-screen.tsx:313` - "Trade memes, earn rewards"
- `apps/mobile/components/swipe-token-deck.tsx` - Swipe mechanics

---

### 3. **Missing Required Disclosures (Guideline 5.1.1)**
**Risk Level: HIGH**

**Issues Found:**
- No Terms of Service visible in app
- No Privacy Policy visible in app
- No risk disclosures for financial trading
- Missing license information

**Required Actions:**
- ✅ Add Terms of Service link in app (Settings/Profile)
- ✅ Add Privacy Policy link in app
- ✅ Add "Risk Disclosure" before first trade
- ✅ Display financial licenses (if applicable)

**Code References:**
- `apps/mobile/app/terms.tsx` exists but needs to be linked prominently

---

### 4. **Payment Processing (Guideline 3.1.1)**
**Risk Level: HIGH**

**Issues Found:**
- Stripe integration for payments (bypasses Apple IAP)
- Premium features may require IAP
- Deposit functionality uses external payment

**Required Actions:**
- ✅ If selling digital goods/services, MUST use Apple IAP
- ✅ If facilitating real crypto trades, external payment is allowed BUT needs clear disclosure
- ✅ Add "Powered by Stripe" disclosure if using Stripe
- ✅ Ensure you're not selling "premium features" without IAP

**Code References:**
- `apps/api/.env:STRIPE_SECRET_KEY`
- `apps/mobile/app/deposit.tsx`

---

## ⚠️ MEDIUM RISK ISSUES

### 5. **Incomplete App Metadata (Guideline 2.1)**
**Risk Level: MEDIUM**

**Issues Found:**
- App name "Swipeit" vs slug "memeswipe" inconsistency
- Missing app icon configuration
- Missing splash screen configuration
- No app description/keywords

**Required Actions:**
- ✅ Add proper app icon (1024x1024)
- ✅ Add splash screen
- ✅ Ensure consistent branding
- ✅ Add comprehensive app description

**Code References:**
- `apps/mobile/app.json` - Missing icon, splash configuration

---

### 6. **Third-Party Login Requirements (Guideline 4.8)**
**Risk Level: MEDIUM**

**Issues Found:**
- Twitter/X login required for onboarding
- No "Sign in with Apple" option

**Required Actions:**
- ✅ **CRITICAL**: Add "Sign in with Apple" as primary option
- ✅ Make Twitter optional, not required
- ✅ Or allow email-only signup

**Code References:**
- `apps/mobile/components/onboarding-screen.tsx` - Twitter required
- `apps/mobile/.env:EXPO_PUBLIC_PRIVY_APP_ID` - Privy auth

---

### 7. **Wallet/Crypto Integration (Guideline 3.1.5)**
**Risk Level: MEDIUM**

**Issues Found:**
- Solana wallet creation/management
- Private key handling
- External wallet linking (Phantom)

**Required Actions:**
- ✅ Add security warnings about private keys
- ✅ Explain wallet is non-custodial
- ✅ Add backup/recovery instructions
- ✅ Warn users about scams/phishing

**Code References:**
- `apps/mobile/contexts/wallet-context.tsx`
- `apps/mobile/lib/devWallet.ts`

---

## ⚠️ LOW RISK ISSUES

### 8. **API Endpoint Hardcoded (Guideline 2.5.1)**
**Risk Level: LOW**

**Issues Found:**
- Production API URL hardcoded: `https://memeswipe.onrender.com`
- May cause issues if backend is down during review

**Required Actions:**
- ✅ Ensure backend is stable and fast during review
- ✅ Add error handling for API failures
- ✅ Consider adding fallback/retry logic

---

### 9. **External Links (Guideline 5.1.1)**
**Risk Level: LOW**

**Issues Found:**
- Links to DexScreener, Twitter, websites
- May redirect users outside app

**Required Actions:**
- ✅ Add "You are leaving the app" warnings
- ✅ Use in-app browser (SafariViewController) when possible

**Code References:**
- `apps/mobile/components/swipe-token-deck.tsx` - External links

---

## 📋 RECOMMENDED CHANGES BEFORE SUBMISSION

### Critical (Must Fix):
1. **Add "Sign in with Apple"** - Required by Apple guidelines
2. **Add Terms of Service & Privacy Policy** - Linked prominently in app
3. **Add Risk Disclosure** - Before first trade, clear warnings
4. **Remove "earn rewards" language** - Sounds like gambling
5. **Age Gate** - Require 18+ verification
6. **Financial Disclaimer** - "Not financial advice" on every screen

### High Priority:
7. Add app icon and splash screen
8. Implement proper error handling for API failures
9. Add security warnings for wallet/private keys
10. Ensure Stripe compliance (or switch to IAP if needed)

### Medium Priority:
11. Add educational content about trading risks
12. Implement "leaving app" warnings for external links
13. Add backup/recovery flow for wallets
14. Improve onboarding to make Twitter optional

---

## 📝 SUGGESTED DISCLAIMERS TO ADD

### On First Launch:
```
⚠️ RISK WARNING
Trading cryptocurrencies involves substantial risk of loss. 
Only trade with funds you can afford to lose. This app does 
not provide financial advice. You are solely responsible for 
your trading decisions.

By continuing, you confirm you are 18+ years old and understand 
these risks.
```

### On Every Trading Screen:
```
Not financial advice. Trade at your own risk.
```

### In Settings/About:
```
Swipeit is a cryptocurrency trading interface. We are not a 
licensed financial advisor. All trades are executed on-chain 
and are irreversible. Always verify transaction details before 
confirming.
```

---

## 🔍 TESTING RECOMMENDATIONS

Before submission:
1. Test with TestFlight beta for 1-2 weeks
2. Ensure backend is stable (no 502 errors)
3. Test all payment flows thoroughly
4. Verify all external links work
5. Test wallet creation/recovery flows
6. Ensure app works without internet (graceful degradation)

---

## 📞 ADDITIONAL RESOURCES

- [Apple App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Financial Apps Guidelines](https://developer.apple.com/app-store/review/guidelines/#financial-apps)
- [Sign in with Apple](https://developer.apple.com/sign-in-with-apple/)
- [In-App Purchase Guidelines](https://developer.apple.com/app-store/review/guidelines/#in-app-purchase)

---

## ⚡ QUICK FIX CHECKLIST

- [ ] Add "Sign in with Apple"
- [ ] Add Terms of Service link
- [ ] Add Privacy Policy link  
- [ ] Add risk warning on first launch
- [ ] Add age gate (18+)
- [ ] Remove "earn rewards" text
- [ ] Add "Not financial advice" disclaimer
- [ ] Add app icon (1024x1024)
- [ ] Add splash screen
- [ ] Test backend stability
- [ ] Add wallet security warnings
- [ ] Make Twitter login optional
- [ ] Add educational content about risks
- [ ] Verify Stripe/payment compliance
- [ ] Add "leaving app" warnings for external links

---

**Estimated Rejection Risk: HIGH (70-80%)**

The primary concerns are:
1. Financial trading without proper disclaimers/licenses
2. Missing "Sign in with Apple"
3. Gambling-like mechanics
4. Payment processing compliance

**Recommendation:** Address all CRITICAL and HIGH priority issues before first submission to increase approval chances to 60-70%.

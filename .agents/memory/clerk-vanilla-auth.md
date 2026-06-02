---
name: Clerk vanilla JS auth (headless)
description: How to integrate Clerk in a plain Vite/JS app without React — avoids the "not loaded with UI components" error
---

## Rule
Do NOT use `clerk.mountSignIn()` or `clerk.mountSignUp()` in a plain JS/Vite app. These require UI component chunks that fail to lazy-load outside of the official CDN context.

Instead, use Clerk's headless client API to build a custom sign-in form.

**Why:** `mountSignIn` calls `assertComponentsReady()` internally, which checks for `#componentControls`. When `clerk.browser.js` is served locally (copied to `public/`), the UI chunk dynamic imports fail to resolve their publicPath correctly, leaving `#componentControls` unset. The headless API makes direct fetch calls to Clerk's FAPI and never needs UI chunks.

**How to apply:** Always implement auth with a custom email/OTP form when using plain JS (non-React) apps.

## Sign-in (existing user)
```js
const si = await clerkInstance.client.signIn.create({ identifier: email });
const emailFactor = si.supportedFirstFactors?.find(f => f.strategy === 'email_code');
await si.prepareFirstFactor({ strategy: 'email_code', emailAddressId: emailFactor.emailAddressId });
// ... get code from user ...
const result = await si.attemptFirstFactor({ strategy: 'email_code', code });
await clerkInstance.setActive({ session: result.createdSessionId });
```

## Sign-up (new user — triggered on `form_identifier_not_found` error from signIn)
```js
const su = await clerkInstance.client.signUp.create({ emailAddress: email });
await su.prepareEmailAddressVerification({ strategy: 'email_code' });
// ... get code from user ...
const result = await su.attemptEmailAddressVerification({ code });
await clerkInstance.setActive({ session: result.createdSessionId });
```

## Loading Clerk
```html
<script src="/clerk.browser.js" data-clerk-publishable-key="pk_test_xxx" crossorigin="anonymous"></script>
```
Then in JS:
```js
clerkInstance = window.Clerk; // singleton in v6, NOT a class
await clerkInstance.load({ publishableKey, proxyUrl, appearance });
```

## Key: `window.Clerk` in v6 is a singleton instance, NOT a constructor. Never `new window.Clerk()`.

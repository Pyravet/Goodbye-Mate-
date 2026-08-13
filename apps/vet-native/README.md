# Goodbye Mate — Vet (native)

React Native app built with Expo. One codebase, both iOS and Android.

## What's here
- Real login against the same backend as the web apps (uses SecureStore
  instead of cookies — see `src/api/client.js`)
- Jobs list: pending offers (accept/decline), assigned jobs
- Job detail: tap-to-call, tap-for-directions, procedure-done, medical notes
- Push notifications via Expo's push service (`src/push.js`)
- Change password

## Running it locally (no app store needed for this)

1. Install [Expo Go](https://expo.dev/go) on your phone (App Store / Play Store)
2. On your computer:
   ```bash
   cd apps/vet-native
   npm install
   npx expo start
   ```
3. Scan the QR code Expo prints with your phone (Camera app on iOS, Expo Go app on Android)

This runs the real app on your actual phone — no build/submission needed for testing.

## Building a real installable app (TestFlight / Play internal testing / production)

This needs an [Expo account](https://expo.dev) (free) and EAS CLI:

```bash
npm install -g eas-cli
eas login
eas build:configure
eas build --platform ios      # or --platform android, or --platform all
```

EAS builds in the cloud — no Mac needed even for iOS. First iOS build will
prompt you to either provide an Apple Developer account or let EAS manage
signing credentials for you.

**Before submitting to app stores you'll need:**
- Apple Developer Program membership ($99/year) — for iOS
- Google Play Developer account ($25 one-time) — for Android

```bash
eas submit --platform ios
eas submit --platform android
```

## Configuration

`app.json` → `expo.extra.apiUrl` points at the production API
(`https://goodbye-mate-production.up.railway.app/api`). Change this if the
API URL ever changes, or add an `app.config.js` for per-environment values
if you want separate dev/staging/production builds later.

## What's not built yet
- App icons/splash are generated placeholders using the brand mark — worth
  a final design pass before a real store submission
- No offline queueing (if a vet loses signal mid-action, the action just
  fails — worth adding a retry queue before this is in daily heavy use)
- No crash reporting / analytics wired in (Sentry or similar, when ready)

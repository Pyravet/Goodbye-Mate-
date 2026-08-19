# Goodbye Mate — Vet app (native)

React Native / Expo app for vets. Feature parity with the vet web app.

## What's in it

- **Jobs** — offers (accept/decline), job detail, directions, en-route ETA,
  procedure/consent actions
- **Medical notes** — append-only log; every entry timestamped and attributed,
  matching the web app. Entries can't be edited or deleted; corrections are
  added as a new entry.
- **Notes from admin** — shown prominently above the job details
- **Veterinary record** — opens the formal PDF (company + vet registration,
  pet details, clinical notes) for insurer requests
- **Messages** — inbox, threads, compose to admin, long-press your own
  message to delete it
- **Earnings** — summary plus weekly payout periods with RCTI download
- **Push notifications** — job offers, messages, status changes

## Testing it without a build

The fastest way to try this is Expo Go — no App Store or Play Store
involvement, no build server:

1. Install **Expo Go** on your phone (App Store / Play Store).
2. On your computer:
   ```bash
   cd apps/vet-native
   npm install
   npx expo start
   ```
3. Scan the QR code that appears — iOS with the Camera app, Android from
   inside Expo Go.

The app points at the live production API, so log in with a real vet
account and you'll see real data.

### Caveats with Expo Go
- **Push notifications don't work in Expo Go** on a real device; they need a
  development or production build (see below). Everything else does.
- The phone and computer must be on the same network. If the QR code won't
  connect, run `npx expo start --tunnel`.

## Building a real installable app

Push notifications and store distribution need EAS:

```bash
npm install -g eas-cli
eas login
eas build --platform android --profile preview   # .apk for sideloading
eas build --platform ios --profile preview       # needs an Apple dev account
```

`eas.json` already has the profiles. `preview` produces an installable
build for testing; `production` is for store submission.

An Apple Developer account ($149/yr AUD) is required for any iOS build,
including internal testing. Android has no such requirement — the
`preview` profile gives you an `.apk` you can install directly.

## Configuration

`app.json` → `expo.extra.apiUrl` points at the API. It's set to production;
change it to `http://<your-computer-ip>:4000/api` to test against a local
server (localhost won't resolve from a phone).

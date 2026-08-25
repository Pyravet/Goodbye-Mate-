# Goodbye Mate — vet app (Expo)

## Running it

```bash
npm install
npx expo start
```

Then scan the QR code with **Expo Go** (Camera app on iPhone, in-app
scanner on Android).

## If `npm install` fails, or `expo start` can't find a module

Delete the previous install and try again:

```bash
rm -rf node_modules package-lock.json
npm install
```

You need **Node 20 or newer** (`node -v` to check).

## Why a lockfile is committed

Without `package-lock.json`, every `npm install` resolves versions
fresh, and two machines can end up with different — sometimes broken —
dependency trees. That's what caused the `Cannot find module
'supports-color'` failure: a half-resolved tree that npm then couldn't
repair, reporting `Invalid Version:` on the retry.

The lockfile pins a tree that is known to install and run.

## Push notifications

These do **not** work in Expo Go — that's an Expo Go limitation, not a
fault in the app. Everything else does. To test push you need a real
build:

```bash
npm install -g eas-cli
eas login
eas build --platform android --profile preview
```

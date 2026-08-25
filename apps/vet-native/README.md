# Goodbye Mate — vet app (Expo)

## Before you start

**Extract to an EMPTY folder.** Do not unzip over a previous copy. npm
will try to reconcile the two and you end up with a half-old,
half-new `node_modules` — which is what produces errors like
`Cannot find module 'supports-color'` and `Invalid Version:`.

If you already have a broken folder, that's fixable — see Troubleshooting.

**Node 20 or 22.** Check with `node -v`. Node 24 is newer than this
Expo version's toolchain was tested against.

## Setup

```bash
cd vet-native
npm install
npx expo start
```

Then scan the QR code — iPhone: Camera app. Android: inside Expo Go.

## Troubleshooting

### `Cannot find module 'supports-color'` / `Invalid Version:`

A corrupted `node_modules`, almost always from installing over an older
copy. Wipe and reinstall:

```bash
rm -rf node_modules package-lock.json
npm cache clean --force
npm install
```

### Wrong package versions installed

If `npm install` reports deprecation warnings for `@react-navigation/*`
v6, you're installing over an old copy — this app uses v7. Do the wipe
above.

### Node version

```bash
node -v                # want v20.x or v22.x
```

If you're on 24 and hitting odd module errors:

```bash
# with nvm installed
nvm install 20
nvm use 20
rm -rf node_modules package-lock.json
npm install
```

### QR code won't connect

Phone and computer are on different networks:

```bash
npx expo start --tunnel
```

### App crashes on open

Shake the phone → Reload. If it persists, the terminal shows the real
error — send that text.

## Known limitation

**Push notifications don't work in Expo Go.** That's an Expo Go
restriction, not a fault in the app. Everything else works. For push you
need a real build (`eas build`).

# @eeyzs1/dsh-chime

Profile-installable DSH bundle: play a browser chime when any conversation finishes a turn or waits for user input.

## Build

The web client loads `exports["./client"]` as a classic script and requires a `__ModuleLoader__.load` handoff. Edit `src/client.js` (CJS module body), then:

```bash
npm run build
```

This writes `lib/client.js`. `prepack` runs the same step.

## Install

```bash
dsh plugin --profile web add <path-or-package>
```

Or link this directory into `$DSH_HOME/profiles/web` and list `@eeyzs1/dsh-chime` under `dsh.profile.bundles`.

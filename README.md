# GARDENA smart system — external integration for Gladys Assistant

[Gladys Assistant](https://gladysassistant.com) external integration for the
**official public GARDENA smart system API**: control your robotic mowers, water
valves, outdoor power sockets and soil sensors from Gladys, in real time.

Built on the [JavaScript integration SDK](https://github.com/GladysAssistant/integration-sdk-js),
from the [official template](https://github.com/GladysAssistant/integration-template-js).

## Supported devices

| GARDENA product                  | GARDENA services        | Gladys features                                                                         |
| -------------------------------- | ----------------------- | --------------------------------------------------------------------------------------- |
| smart Mower (SILENO…)            | `MOWER`, `COMMON`       | Mowing (on/off), activity, state, last error, operating hours, battery, signal          |
| smart Water Control              | `VALVE`, `VALVE_SET`    | Watering (on/off), activity, watering time left, battery, signal                        |
| smart Irrigation Control         | `VALVE` ×6, `VALVE_SET` | One watering switch, activity and time left **per outlet**, named as in the GARDENA app |
| smart Power (outdoor socket)     | `POWER_SOCKET`          | On/Off, activity, time left, signal                                                     |
| smart Sensor / smart Soil Sensor | `SENSOR`                | Soil humidity, soil temperature, ambient temperature, light intensity, battery, signal  |

One Gladys device per **physical** GARDENA device: a Smart Irrigation Control is
one device carrying six independent watering outlets, not six devices.

## How it works

```
Husqvarna auth API  ──── OAuth2 client_credentials ────▶ access token
GARDENA smart API   ──── GET /v2/locations/{id} ───────▶ the whole garden (REST)
                    ──── POST /v2/websocket ──────────▶ a real-time stream URL
                    ──── PUT  /v2/command/{service} ──▶ mow, water, switch on
```

- **Real time first.** One websocket per location carries every change (device,
  GARDENA app, schedule) within a second or two. GARDENA closes it about every
  two hours: the integration reconnects with a fresh URL and resynchronizes.
- **REST sparingly.** The GARDENA API is heavily rate-limited, so the client
  serializes and spaces out its calls, and the periodic poll is only a safety
  net whose refreshes are shared between all devices.
- **States are deduplicated.** Only values that actually changed are published,
  and only for the devices the user created in Gladys.
- **The state is what GARDENA says**, never what Gladys asked for: a mower that
  came home because of the rain shows as stopped.

## Project structure

```
.
├─ index.js                          # SDK bootstrap + event wiring (no GARDENA logic)
├─ src/
│  ├─ gardenaService.js              # orchestrator: session, discovery, states, commands
│  ├─ config.js                      # configuration defaults + normalization
│  ├─ gardena/                       # the vendor API
│  │  ├─ constants.js                #   hosts, service types, commands, activities
│  │  ├─ client.js                   #   OAuth2 + REST + rate limiting
│  │  ├─ realtime.js                 #   websocket with keep-alive and backoff
│  │  └─ model.js                    #   JSON:API services -> one object per device
│  └─ devices/                       # the Gladys mapping, one file per service type
│     ├─ index.js                    #   registry: features, states, commands
│     ├─ common.js                   #   battery + signal (every device)
│     ├─ mower.js, valve.js, powerSocket.js, sensor.js
│     └─ helpers.js
├─ docs/en.md, docs/fr.md            # user documentation (re-hosted by Gladys)
├─ gladys-assistant-integration.json # manifest (config schema, actions, image)
└─ test/                             # node --test, no test framework
```

Adding a future GARDENA service type is one file in `src/devices/` plus one line
in `src/devices/index.js`.

## Getting your GARDENA credentials

Create a free application on the [Husqvarna developer portal](https://developer.husqvarnagroup.cloud/),
**connect the GARDENA smart system API to it** (this step is what most 403s come
from), and copy its Application key and Application secret into the integration
configuration. The full walkthrough is in [`docs/en.md`](./docs/en.md) /
[`docs/fr.md`](./docs/fr.md).

## Run it locally

```bash
npm install
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="gardena-smart-system" \
LOG_LEVEL=debug \
npm start
```

The three `GLADYS_*` variables are injected by the Gladys supervisor when the
integration runs in its sandboxed container; the GARDENA credentials come from
the integration configuration, never from the environment.

## Quality checks

```bash
npm run format:check   # Prettier
npm run lint           # ESLint
npm test               # node --test
```

The same three gates run on every push and pull request
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

Before tagging a release, you can also run the store validation locally:

```bash
npx github:GladysAssistant/integration-store .
```

## Publishing

1. Add the GitHub topic `gladys-assistant-integration` to the repository.
2. **Actions → Release → Run workflow**, pick `patch`, `minor` or `major`: the
   workflow bumps the version everywhere (`package.json` + manifest `version`
   and `docker_image`), pushes the `vX.Y.Z` tag and builds the
   `linux/amd64` + `linux/arm64` image to `ghcr.io`.
3. The decentralized indexer picks up the new manifest version and Gladys offers
   a one-click install or update.

Replace `cover.png` (800×534 px, ≤150 KB) with a GARDENA-flavoured cover before
publishing: the bundled one is the template's plain gradient placeholder.

## License

Apache-2.0

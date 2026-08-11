# GARDENA smart system

Control your GARDENA garden from Gladys: robotic mowers, water valves, outdoor
power sockets and soil sensors. The integration talks to the **official public
GARDENA smart system API**, the same one the GARDENA app uses, so everything
stays in sync in both directions.

## What you need

- a **GARDENA smart gateway** already installed, with your devices paired and
  working in the GARDENA app;
- a free account on the **Husqvarna developer portal** (GARDENA belongs to the
  Husqvarna Group) — the API is free for personal use.

The integration never talks to your devices directly: GARDENA devices speak a
proprietary radio protocol to the gateway, and the gateway only talks to the
GARDENA cloud. An Internet connection is therefore required.

## Step 1 — Create your API application

1. Go to <https://developer.husqvarnagroup.cloud/> and click **Sign in**.
2. Sign in with **your usual GARDENA account** (the one from the GARDENA app).
   There is no separate account to create.
3. Open **My applications** and click **New application**. Give it any name,
   for example `Gladys`. The redirect URI is not used by this integration: you
   can leave it empty or put `http://localhost`.
4. On the application page, click **Connect new API** and connect the
   **GARDENA smart system API**. This step is easy to miss, and without it the
   API answers `403 Forbidden` to every request.
5. Copy the **Application key** and the **Application secret** shown on that
   page.

> Keep the Authentication API connected as well — it is usually added
> automatically, and it is the one that issues the token.

## Step 2 — Configure the integration in Gladys

1. Paste the **Application key** and the **Application secret** in the
   configuration screen, then save.
2. Click **Test the connection**: the integration authenticates and lists the
   locations (gardens) of your account.
3. Go to the **Discover** tab: every GARDENA device of your account appears.
   Create the ones you want to use in Gladys.

Optional settings:

| Setting                    | What it does                                                                                                                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Location id**            | Restrict the integration to a single garden. Leave empty to use all of them.                                                                                                                   |
| **GARDENA API refresh**    | Minimum delay between two full reads of the GARDENA API, the safety net behind the real-time stream. GARDENA rate-limits its API: keep it high, changes already arrive within a second or two. |
| **Default duration**       | How long a valve waters, or a socket stays on, when you switch it on from Gladys.                                                                                                              |
| **Power socket switch-on** | Switch off automatically after the default duration, or stay on until switched off.                                                                                                            |
| **Mower start**            | Starting the mower can obey its own calendar, or override it for a fixed duration.                                                                                                             |
| **Mower stop**             | Stopping the mower can park it until its next scheduled task, or cancel the schedule until further notice.                                                                                     |

## What you get in Gladys

| GARDENA device                   | Features created                                                                        |
| -------------------------------- | --------------------------------------------------------------------------------------- |
| smart Mower (SILENO...)          | Mowing (on/off), activity, state, last error, operating hours, battery, signal          |
| smart Water Control              | Watering (on/off), activity, watering time left, battery, signal                        |
| smart Irrigation Control         | One watering switch, activity and time left **per outlet**, named as in the GARDENA app |
| smart Power (outdoor socket)     | On/Off, activity, time left, signal                                                     |
| smart Sensor / smart Soil Sensor | Soil humidity, soil temperature, ambient temperature, light intensity, battery, signal  |

Switching a valve on starts a **manual watering of the configured duration**:
the GARDENA API has no "open forever" command on a valve, which is exactly what
you want from a home automation system connected to a water tap.

The on/off state of a mower, a valve or a socket always reflects what GARDENA
reports, not what Gladys asked for: a mower that came home because of the rain,
or a valve opened from the GARDENA app, shows up correctly in Gladys.

## Real time

The integration keeps a websocket open to GARDENA for each location, which is
the supported way to follow a garden: a change made on the device, in the
GARDENA app or by a schedule reaches Gladys within a second or two. The
scheduled refresh is only a safety net for a missed message.

GARDENA closes that websocket about every two hours, on purpose: the
integration reconnects on its own, and resynchronizes each time.

Gladys ticks its devices every minute (its shortest supported interval), but
that tick does **not** call GARDENA: the integration answers from the picture it
already holds, and only re-reads the GARDENA API once the picture is older than
the **GARDENA API refresh** setting. Whatever the number of devices in your
garden, one refresh costs one API call.

## Actions

- **Test the connection** — authenticates and lists the locations of the
  account. Use it first when something looks wrong.
- **Refresh the devices** — re-reads the account, for example after adding a
  device in the GARDENA app.
- **Stop all watering** — closes every valve of the chosen device until its next
  scheduled task. Handy in a scene, or when you want to walk in the garden.

## Troubleshooting

**"GARDENA refused the credentials"** — the Application key or secret is wrong,
or the **GARDENA smart system API is not connected to your application** on the
developer portal (step 1.4). This is by far the most common cause.

**A device shows an orange "unreachable" badge** — the GARDENA gateway does not
see it anymore (radio link offline): the device is out of range, switched off,
or its batteries are empty. Gladys keeps the last known values instead of
pretending they are current.

**"GARDENA is rate-limiting the integration"** — the API is throttling. The
integration spaces its calls out and retries, but if you increased the refresh
frequency a lot, put it back to a higher value: the real-time stream already
gives you the changes.

**No device in the Discover tab** — check that your devices show up in the
GARDENA app, and that the location filter (if you set one) matches the right
garden.

# Changelog

What changed for you, release by release. Gladys links the version number of
an installed integration to this repository's releases, so each entry here is
also the body of the matching GitHub release.

_Version française : [CHANGELOG.fr.md](./CHANGELOG.fr.md)._

## 1.1.0

**Requires Gladys 5.1.0 or newer**, which is what brings dashboard cards to
external integrations. On an older Gladys the update is simply not offered,
and 1.0.2 keeps working. Nothing to reconfigure, and no device to re-create:
your devices, their history and your settings are untouched.

### Two cards for your dashboards

Add them from the box picker of any dashboard.

**GARDENA watering**

- one line per watering outlet and for the outdoor socket, in plain words —
  and a pressure pump is now spoken of as running or stopped, where GARDENA
  reports it as a valve and it used to read "closed";
- one soil humidity tile per sensor, which follow the values live;
- the **curve of the soil humidity over the past week**, drawn from the
  history Gladys already keeps: what says the soil is drying, where a number
  only says the instant;
- **Stop watering**, which closes every valve of the account at once;
- **Water for…**, to open one outlet for a chosen duration;
- a button to switch the socket on or off, whose label follows its state.

**GARDENA mower**

- activity, state and last error, in plain words;
- battery gauge and operating hours;
- **Mow now** or **Park**, whichever matches what the mower is doing;
- **Mow for…**, for a one-off duration;
- **Park, no schedule**, which asks for a confirmation since it cancels the
  mower calendar until you start it again.

**Showing a card costs nothing against your weekly GARDENA quota.** The cards
render the picture the real-time stream already keeps in memory; only tapping
an action button sends a request, one per command.

Each card has one optional setting — which sensor it focuses on, which mower
its buttons control — for gardens with several. Leave it empty otherwise.

One thing to know about the curve: with several sensors, the legend repeats
"Soil humidity", because Gladys names a chart series after the feature it
reads and not after the device. What tells the curves apart is their shape.
Pin a sensor in the card settings to get a single curve, named after it in
the chart title, or put one card per zone.

### Fixed

- The periodic refresh behind the real-time stream — the safety net for a
  message the websocket missed — was never actually armed. Devices created
  from this version on get it. Already created devices are unaffected and keep
  running on the real-time stream, which resynchronizes the whole garden at
  every reconnection; re-creating them only to arm the safety net would cost
  their history, which is not worth it.

## 1.0.2

- Catalog categories (Appliances, Environment), so the integration shows up
  under the catalog filters of Gladys 4.86.

## 1.0.1

First release on the store.

- Mowers, water valves, Irrigation Control outlets, outdoor sockets and soil
  sensors, driven through the official public GARDENA smart system API;
- real-time first: one websocket per location carries every change, whether it
  comes from the device, the GARDENA app or a schedule;
- built around the **weekly request quota** of a free GARDENA application:
  refreshes are shared between all devices, spaced out, and suspended for an
  hour if GARDENA ever answers "too many requests";
- soil humidity published as a decimal, which is what Gladys renders;
- the GARDENA logo as the catalog cover.

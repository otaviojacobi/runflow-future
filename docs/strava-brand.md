# Strava: brand guidelines and how Runflow follows them

Source: https://developers.strava.com/guidelines/ (read 2026-11-04). Sharing rules (who may connect, what staff see,
when Strava is disconnected): D-011 in `root.md` and `api/endpoints.md` § Strava sharing.

## The rules

1. **"Connect with Strava" button.** Only Strava's official artwork (orange or white; 48 px high at 1x, 96 px at 2x),
   linking to `strava.com/oauth/authorize` or `strava.com/oauth/mobile/authorize` (our API's `authorize_url` already
   does). Never modify, recolor, crop or animate it.
2. **"Powered by Strava" / "Compatible with Strava".** Official logos (orange, white or black; horizontal or
   stacked), completely separate from our name and logo and never more prominent than them.
3. **"View on Strava".** Optional; when we link back to an activity, the text reads exactly "View on Strava" (not
   translated), legible, with at least one of bold, underline or Strava orange (`#FC5200`).
4. **Naming.** Never "Strava" in our app's name. Plain, truthful references are fine ("via Strava", "Sincronizada do
   Strava"), but the word is never larger than the text around it or more prominent than "Runflow".
5. **No implied endorsement**, and no Strava logo as an icon of ours.

## Where we use what

| What | Web (`frontend/src/components/strava.tsx`) | App (`mobile/src/components/strava.tsx`) |
|---|---|---|
| Official button (orange, 237 × 48) | `StravaConnectButton`: SVG, the focus ring around it; accessible name "Conectar com Strava" + the artwork's own words | `StravaConnectButton`: PNG @1x/@2x, a ring around it when pressed; never dimmed (a disabled button is explained by the text next to it) |
| Where it's pressed | `components/account/StravaConnect.tsx` `StravaConnectPanel`: welcome, Atividades, Minha conta → Relógios e apps | `components/connections/StravaConnect.tsx` `StravaConnectPanel`: welcome, Atividades, Relógios e apps |
| Powered by Strava (black on light, white on dark) | `PoweredByStrava`: Hoje's last activity, the Atividades list, the activity, the connected card, and staff views (student page, workout dialog, Feedbacks) | same places in the app (Hoje, Atividades, the activity, the student's workout, Relógios e apps, staff student page and workout sheet) |
| View on Strava (`strava.com/activities/{external_id}`, bold + underlined) | `ViewOnStrava` on a Strava activity's detail, the trainer's workout dialog and Feedbacks | the activity detail and the staff workout sheet |

The light/dark logo on the web follows the nearest `data-theme` (CSS variables in `frontend/src/styles.css`,
`.rf-art-light` / `.rf-art-dark`), like the tokens.

## The artwork

Unmodified copies of Strava's downloads, with their sources in a README next to them:
`frontend/src/assets/strava/` (SVG) and `mobile/assets/strava/` (PNG). New sizes or colors come from the same zips:
https://developers.strava.com/downloads/1.1-Connect-with-Strava-Buttons.zip and
https://developers.strava.com/downloads/1.2-Strava-API-Logos.zip.

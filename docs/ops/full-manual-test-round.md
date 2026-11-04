# Full manual test round (QA)

A walk through everything Runflow does, on QA (https://qa.runflow.club), with three real accounts: an **owner**, a
**trainer** and a **student** whose Strava is yours, so a real run flows from your watch to the trainer's inbox.
Tick the boxes as you go; write down anything odd with the time (Sentry and Grafana keep the trail).

QA was reset on 2026-11-03 (no accounts, clubs or uploads). Start over any time: `ssh runflow@runflow-qa.local`,
then `cd ~/runflow/ops/qa && ./reset-db.sh --yes` (database, uploads and Valkey; D-039).

---

## 0. Before you start

### Accounts (one inbox is enough)
| Role | E-mail (example) | Signs in with |
|---|---|---|
| Owner | `you+owner@gmail.com` | e-mail code (web), or Google on the web if it's a Google account |
| Trainer | `you+trainer@gmail.com` | e-mail code |
| Student | the e-mail you want, **you connect your own Strava** | e-mail code (the app has no Google sign-in yet, X16) |

Gmail delivers `+alias` addresses to your inbox, and each alias is a separate Runflow account. Codes arrive from
`contato@runflow.club` within seconds (check spam the first time).

### Strava (once)
- [ ] strava.com/settings/api → **Authorization Callback Domain** is `qa.runflow.club` (open item in `setup-todo.md`;
      without it "Conectar com Strava" fails on Strava's page, on the web and in the app).
- The Strava API app is limited to **one athlete** (you) until Strava approves more: only the student connects Strava.
- The webhook is already subscribed (`setup-todo.md`): new activities reach QA within about a minute.

### Devices
- **Computer:** the web app for the owner and the trainer. Use two browser profiles (or one normal + one private window)
  so both stay signed in.
- **Android phone:** the app for the student (and the trainer, if you want to try staff on mobile). See §1.
- Desktop Chrome can install the web app (address bar → "Instalar") to try web push.

### Seeing the data
- **Database viewer (pgweb):** http://runflow-qa.local:8091 (from your home network; if `.local` doesn't resolve, use
  the NUC's IP). User `runflow`; password: `ssh runflow@runflow-qa.local grep PGWEB_PASSWORD runflow/ops/qa/.env`.
  Read-only: browse tables on the left, or run a `select` in "Query". Handy tables: `users`, `clubs`,
  `memberships`, `invitations`, `consents`, `provider_connections`, `activities`, `planned_workouts`,
  `workout_completions`, `comments`, `notifications`, `push_tokens`, `club_subscriptions`, `invoices`, `jobs`,
  `webhook_events`.
- **Logs and metrics:** https://grafana-qa.runflow.club ("Runflow QA" dashboard; Explore → Loki for API logs).
- **Errors:** Sentry, org `runflow-zw`, the QA projects.
- **Version on QA:** https://qa.runflow.club/api/v1/health (it shows `version+commit`; QA updates itself within 5
  minutes of each push).

---

## 1. Install the app on the phone

### Android: the APK (recommended)
1. Open the APK link (or scan the QR) from the EAS build, on the phone. The build is made with `npm run apk` (Expo's
   servers, `mobile/eas.json` profile `preview`); `npm run eas -- build:list` shows past builds and their links.
2. Allow installing from the browser when Android asks ("Instalar apps desconhecidos"), then install **Runflow**.
3. Open it: it talks to QA. A newer APK installs over the old one (same signature), keeping you signed in.

What this build doesn't have yet:
- **Phone push**: needs your Firebase and Expo push setup (`docs/ops/push-notifications.md`). The app's
  Perfil → Notificações shows the push card's state; notifications still land in the app's bell.
- **Google sign-in in the app** (X16): use the e-mail code.
- **Invite links opening the app**: the e-mail link opens the browser (App Links need the store signing key). Either
  accept the invite on the phone's browser and then sign in on the app, or copy the link and paste it in the app
  (club list → "Tenho um convite").

### Fallback: Expo Go (Android or iPhone, same Wi-Fi as the computer)
`cd mobile && EXPO_PUBLIC_API_URL=https://qa.runflow.club/api/v1 EXPO_PUBLIC_WEB_URL=https://qa.runflow.club npx expo start`,
then scan the QR with Expo Go (SDK 58). Everything works except push and Strava's return to the app (connect Strava on
the web instead).

### Fallback: the web app on the phone
https://qa.runflow.club in the phone's browser (installable from the browser menu); same features, web push on Android.

---

## 2. Owner creates the club (web)
- [ ] https://qa.runflow.club → "Criar meu clube grátis" → e-mail code (owner) → the wizard:
  - [ ] Club data: name, city, state, modalities (Corrida, Natação, Ciclismo, Funcional…).
  - [ ] Studio: upload a logo; accept or change the suggested colors; the phone preview changes.
  - [ ] Invite: the **trainer** (as Treinador) and the **student** (as Aluno), one at a time.
  - [ ] Library: the starter workouts for the chosen modalities. → Painel with the onboarding checklist.
- [ ] Both invite e-mails arrive **in the club's colors**, with the club's logo (D-036).
- [ ] The "runflow" logo top left goes back to the landing page.
- DB: `clubs`, `club_branding`, `memberships` (owner), `invitations` (2, pending), `workout_templates`.

## 3. Trainer joins (web)
- [ ] Open the trainer's invite link → "Marcos te convidou" style page → sign in with the trainer e-mail (pre-filled,
      locked) → accept → Painel.
- [ ] Owner → Membros e convites: the trainer under Equipe; the invite shows accepted.
- [ ] Free plan seats: inviting a **second trainer** is refused with the pt-BR seat message (Free = 1 trainer).
- DB: `memberships` (trainer), `invitations.accepted_at`.

## 4. Student joins on the phone, with Strava
- [ ] Open the student's invite (see §1 for the link) → sign in with the student e-mail code → "Aceitar convite".
- [ ] Welcome, in the club's colors: consent to share training data → "Nome completo", birth date, WhatsApp →
      **Conectar com Strava** (Strava's page or app → authorize) with "Compartilhar as atividades do Strava…" on →
      done → Hoje.
- [ ] Perfil → Atividades: your last 30 days of Strava activities are there.
- [ ] Trainer (web) → Alunos → the student: Strava "shared", recent activities visible.
- DB: `consents` (`share_training_data`, `share_strava`), `provider_connections` (strava, active), `activities`
  (source `strava`), `jobs` (the import).

## 5. Trainer plans the week
New clubs release weeks by hand or on Sunday 18:00 (`weekly`, D-031): this week is visible as soon as it's planned,
next week stays a draft until released.
- [ ] Web → Planejamento: assign a library workout to the student **today**; another on a later day this week.
- [ ] Build one with quick text in "Montar agora": `10' aquec + 6x1km @4:30 c/ 2' trote + 10' desaq`.
- [ ] Plan something **next week** → the student doesn't see it (Agenda says "em preparação") → "Liberar semana" →
      the student gets the `week_released` notification and sees it.
- [ ] Planilhas: create a 2-week planilha, apply it to the student from next Monday; then unassign it.
- [ ] On the phone (trainer signed in, or the student's view): Hoje, the week strip, Agenda week and month.
- [ ] Mobile staff (optional, sign in as the trainer on the app): Painel, Alunos, Planejamento (assign, move, edit),
      Biblioteca and the builder, Planilhas.
- DB: `planned_workouts`, `week_releases`, `training_plans`, `plan_assignments`, `notifications`.

## 6. Train for real: Strava → Runflow → trainer
Activities are matched to the plan by day and size (D-049, `docs/activity-matching.md`): a workout done a day or two
early or late, cut short, or swapped with another day is found and marked done; only when two workouts are about
equally likely does the student get a question.
- [ ] Record a short activity with Strava (phone or watch) **on a day with a planned workout** (or create a manual
      activity on strava.com for that date).
- [ ] Within ~1 minute: the student's Atividades shows it, linked to the planned workout ("Treino planejado", %
      cumprido); the workout is done and says it was completed with the activity, inviting "Conte como foi".
- [ ] **Swapped day:** plan a short run tomorrow and a long one the day after; run the long distance tomorrow → it
      links to the long workout (the day after), not tomorrow's.
- [ ] **A real doubt:** plan 8 km on one day and 8 km two days later, nothing in between, and run ~8 km on the day in
      between (a manual activity on strava.com with that date works) → Hoje and Atividades ask "Qual treino foi esta
      atividade?" → pick one → it's linked; "Trocar treino" on the activity moves it; "Nenhum destes" leaves it as an
      extra session.
- [ ] Student: "Conte como foi" → PSE, feeling, comment → the trainer gets the feedback (Feedbacks inbox +
      notification, only on this first report, not when the activity was matched); trainer replies in the thread →
      the student sees the reply (bell, the workout's conversation).
- [ ] Rename the activity on Strava → the new name arrives; delete it on Strava → it disappears from Runflow and the
      workout it completed is open again (unless the student had already reported on it).
- [ ] Perfil → Relógios e apps → Desconectar → Strava's activities are deleted and the trainer stops seeing them;
      connect again → the last 30 days come back and are matched again.
- DB: `webhook_events`, `jobs` (`match.activities`), `activities` (`match_state`), `activity_match_options`,
  `workout_completions` (`matched_by`, `reported_at`), `comments`, `notifications`.
- If nothing arrives: Grafana → Loki, search `strava`; `webhook_events` shows whether Strava called at all.

## 7. Messages and the mural
- [ ] Student → Mensagens: write to the staff; trainer answers (web) → "Visto" receipts both ways.
- [ ] Owner posts an announcement to the whole club (pin it) → the student sees it in the mural; "Lido por" counts.

## 8. Notifications
- [ ] The bell's count and the center (Hoje/Ontem/7 dias, mark all read, links open the right screen).
- [ ] Web push (installed web app on the computer): Perfil → Notificações → "Ativar" → a new comment buzzes; switch a
      kind off → no push, still in the center; "Pausar tudo".
- [ ] Staff defaults: feedback and new-member pushes start off (D-045).

## 9. The rest of the coaching tools
- [ ] Provas: owner/trainer creates a race; the student signs up (goal race → profile goal and date); after the date,
      the result.
- [ ] Avaliações: a Cooper or 3 km test for the student with "Atualizar as zonas" → the student's workouts show their
      own paces.
- [ ] Relatórios: period and group; export CSV and PDF.
- [ ] Exercícios (only if the club teaches Musculação): search, a video.
- [ ] Assistente: "Descrever com IA" in the builder; the week suggestion in Planejamento.

## 10. Owner: club, plan and billing (Stripe test mode)
- [ ] Club Studio: change colors/logo → everyone sees the new colors on the next open (web and app).
- [ ] Configurações: trainer label "professor", timezone, week release time.
- [ ] Plano e cobrança → Pro → Stripe Checkout with **4242 4242 4242 4242** (any future date, any CVC) → Pro, invoice
      listed; the billing portal opens. Then Pro → Max and back.
- [ ] Failed payment: in the portal change the card to **4000 0000 0000 0341** and let the next payment fail
      (Stripe dashboard → the subscription → "Charge"/advance) → "Pagamento pendente" banner, still usable (7-day
      grace).
- [ ] Frozen club (D-043), without waiting 7 days. On the NUC:
      ```
      cd ~/runflow/ops/qa && docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "UPDATE club_subscriptions SET status = '"'"'past_due'"'"', past_due_since = now() - interval '"'"'8 days'"'"' WHERE plan <> '"'"'free'"'"'"'
      ```
      → owner and trainer see the icy layer (owner: the way to payment; trainer: "fale com o gestor"), every staff
      change is refused; **the student notices nothing** (web and app). Undo: the same with
      `status = 'active', past_due_since = NULL`.

## 11. Phone-only checks
- [ ] Offline: open Hoje with signal, then airplane mode → Hoje, Agenda and this week's workouts still open, with the
      "Sem internet" banner; changes ask for a connection.
- [ ] Club switcher (if you're in two clubs), light/dark mode (Perfil → Aparência), the back button on every screen.
- [ ] Toasts show above open sheets.

## 12. Account and privacy (last)
- [ ] Perfil → Privacidade e dados: export (JSON through the share sheet), revoke and grant the sharing consent (the
      trainer loses and regains visibility), Aparelhos conectados (sign out another device).
- [ ] Leave the club as the student; then delete the account (type EXCLUIR). Then `./reset-db.sh --yes` when you're
      done.

---

Found something? Note the screen, the account, the time and what you expected. Errors with a stack trace are in
Sentry; everything the API logged is in Grafana → Loki at that time.

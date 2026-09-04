# POJIDMUSIC Telegram Auth Audit

Date: 2026-09-04

## Product invariant

Inside Telegram Mini App, Telegram identity is always the primary entry point. Desktop/browser auth remains email + password.

A Telegram user can be in one of two states:

1. Temporary Telegram listener account (`telegram-<id>@auth.pojidmusic.invalid`).
2. Telegram mapped to a normal pre-existing POJIDMUSIC account.

The action **«Привязать существующий аккаунт»** is valid only for state 1.

## Expected flows

### A. New Telegram user

1. Mini App provides signed `initData`.
2. Client calls `bootstrap`.
3. Backend returns `unlinked`.
4. Client calls `register`.
5. Backend creates a listener-only temporary auth user and `telegram_accounts` mapping.
6. Client exchanges one-time token hash for a Supabase session.
7. Account settings show **«Привязать существующий аккаунт»**.

Expected result: no email/password form is required for first entry from Telegram.

### B. Telegram user already mapped to a POJIDMUSIC account

1. Client calls `bootstrap`.
2. Backend finds `telegram_accounts` mapping.
3. Backend returns a one-time session exchange token.
4. Client enters the mapped Supabase account.
5. **«Привязать существующий аккаунт» must be hidden.**

Expected result: returning Telegram users are logged in automatically.

### C. Temporary Telegram listener links a legacy account

1. User opens account settings.
2. **«Привязать существующий аккаунт»** opens the relink dialog.
3. User enters the email/password of the old POJIDMUSIC account.
4. Supabase verifies credentials.
5. Client sends the verified access token to `relink` together with signed Telegram `initData`.
6. Backend permits reassignment only when the current Telegram mapping belongs to its own synthetic listener account and that source profile has no Artist entity.
7. Mapping moves to the selected existing account.
8. Client redirects/reloads inside Telegram.
9. Future `bootstrap` enters the existing account directly.
10. Relink action disappears.

Expected result: old desktop-created accounts can safely become the Telegram account without creating duplicate artist identities.

### D. Desktop/browser outside Telegram

1. No valid Telegram `initData` is available.
2. Telegram bootstrap/relink UI does not initialize.
3. User signs in with normal email/password.
4. Telegram-only feedback and relink controls are not shown.

Expected result: desktop auth behavior remains independent from Telegram.

## Conflict / safety cases

| Case | Expected result |
| --- | --- |
| Telegram ID already mapped to the same account | Idempotent success |
| Telegram ID already mapped to another real account | `409 Account link conflict` |
| Target POJIDMUSIC account already mapped to another Telegram | `409 Account link conflict` |
| Attempt to relink from a real/artist source account | Reject with `409` |
| Invalid/expired Telegram `initData` | `401 Authentication failed` |
| Invalid Supabase session for `link` / `relink` | `401 Authentication failed` |
| Telegram username does not fit POJIDMUSIC username rules | Linking must still succeed; invalid username must not break mapping |

## UI regression found 2026-09-04

### Relink action stayed visible after a successful link

Cause: JS correctly set `button.hidden = true`, but Telegram profile CSS forced `.profile-action-button { display:flex }`, overriding the browser's native `[hidden] { display:none }` behavior.

Fix: Telegram action CSS now explicitly defines `.profile-action-button[hidden] { display:none!important; }`.

### Header feedback item became a purple duplicated/glitched row

Cause: `telegram-profile-v45.css` styled every `[data-open-feedback]` element. Both the large account-settings action and compact header menu item use that attribute, so the compact menu received the settings icon/background/pseudo-label on top of its own text.

Fix: decorative feedback styling is now scoped to `.profile-actions [data-open-feedback]` only.

## Relink action presentation

The Telegram-only relink action now uses the same action-card language as the rest of account settings:

- link icon;
- title: «Привязать существующий аккаунт»;
- subtitle: «Войти по email и паролю»;
- chevron.

It is created only inside Telegram and is visible only while the current session belongs to the synthetic Telegram listener account.

## Manual acceptance checklist

- [ ] Fresh Telegram account opens without email/password and receives listener account.
- [ ] Fresh Telegram account sees relink action in Settings.
- [ ] Relink action has icon, subtitle and correct row spacing.
- [ ] Wrong password shows a local error and keeps the original Telegram session usable.
- [ ] Successful legacy-account relink redirects and opens the existing account.
- [ ] After successful relink the relink action is absent.
- [ ] Closing/reopening Mini App after relink automatically enters the mapped account.
- [ ] Existing mapped artist account never sees the relink action.
- [ ] Desktop outside Telegram keeps normal email/password login.
- [ ] Compact profile menu shows one clean «Фидбек» row without Telegram settings decoration.
- [ ] Feedback action inside Telegram account settings keeps its icon/subtitle.
- [ ] Invalid Telegram username cannot make auth return 500.
- [ ] `bootstrap`, `register`, `link`, and `relink` do not expose access/refresh tokens or bot secrets.

## Follow-up hardening

`tests/telegram-auth.test.ts` should cover `relink` explicitly, including temporary-listener success, target conflict, source-real-account rejection, source-artist rejection and idempotent relink. The frontend should also get a small DOM regression test asserting that a relink button with the `hidden` attribute computes to `display:none` in Telegram profile styles.

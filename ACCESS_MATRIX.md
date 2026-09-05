# POJIDMUSIC access contract

This file is the source of truth for role and platform-specific UI. New features should follow this matrix instead of adding one-off `role === "artist"` checks.

## Roles

| Capability | Guest | Listener | Artist | Admin |
| --- | --- | --- | --- | --- |
| Browse/search/play published catalog | yes | yes | yes | yes |
| Account/profile settings | no | yes | yes | yes |
| Change account avatar | no | yes | yes | yes |
| Request Artist role | no | yes | no | no |
| Artist page / My tracks | no | no | yes | yes |
| Upload track/album | no | no | yes | yes |
| Manage own artist/profile/tracks | no | no | yes | yes |
| Admin moderation/inbox | no | no | no | yes |

`admin` is an Artist-capable super-role. Any Artist capability must accept both `artist` and `admin`.

## Platforms

### Desktop browser

- Header auth is visible.
- Signed-out users get Login and Registration.
- Registration always creates a Listener. Artist access is requested from Profile and approved by Admin.
- Signed-in users get the compact profile dropdown.
- Artist/Admin upload and artist-management controls are available.
- Mobile bottom navigation is not rendered as an active UI surface.
- Telegram identity can only be linked after cryptographic proof from Telegram. Do not treat a Telegram username typed into a form as proof.

### Mobile browser / installed PWA

- Uses the mobile shell and bottom navigation.
- Guest/Listener: Home, Search, Profile.
- Artist/Admin: Home, Search, Upload, Artist, Profile.
- Admin entry lives inside Profile, not as a sixth bottom-navigation tab.

### Telegram Mini App

- Telegram `initData` is verified server-side by the `telegram-auth` Edge Function.
- Mapped Telegram account: automatically obtains the linked POJIDMUSIC session.
- Unmapped Telegram account: user can sign in to an existing POJIDMUSIC account and link it, or create a new Telegram-backed Listener account.
- Telegram identity does not grant Artist/Admin rights. Rights always come from `profiles.role`.
- Telegram-specific profile styling must be scoped to `html[data-telegram-mini-app="true"]`.

## Auth / Telegram link states

1. Email account, no Telegram mapping: normal account works everywhere. Telegram link is offered only where valid Telegram proof is available.
2. Email account + Telegram mapping: Telegram link action disappears; Profile may display both POJIDMUSIC and Telegram identity.
3. Telegram-backed account: created as Listener. It can later request Artist through the same moderation flow.
4. Existing Telegram mapping: must never be silently reassigned to another POJIDMUSIC account.

A normal desktop browser cannot manufacture Telegram Mini App `initData`. Desktop `Login with Telegram` therefore needs a dedicated Telegram Login Widget/OAuth or a secure bot/Mini-App handoff. It must not reuse the Mini App bootstrap endpoint without Telegram proof.

## UI invariants

- `Profile -> Admin` is visible only to Admin.
- Admin keeps all Artist actions and the five-button mobile bar.
- Listener never sees upload or artist-management actions.
- The Feedback action may have a subtle `bugs / features / ideas` visual easter egg, but the actual label must remain readable and clickable.
- Only one active Telegram profile stylesheet should define the Telegram settings surface.
- Do not introduce duplicate visual components for the same bottom navigation or profile action list. Reuse the live component.

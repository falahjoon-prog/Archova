# 4. Push notifications

## 4.1 Delivery path

**Decision:** push is one channel of the backend `notifications` module, sent **directly to APNs (Apple) and FCM (Google)** by a backend worker. We do not route through a third-party push relay.

```
domain event (defect.assigned)
  → notifications service decides who should be told and on which channels
     (in-app, email, push) using each user's preferences
  → push worker (BullMQ queue) → APNs HTTP/2 (token auth, .p8 key)
                               → FCM HTTP v1 API
```

Why direct: no extra vendor holding device tokens and message content; no third-party rate limits at 100k users; and the same service already handles email and in-app, so rules about who gets told live in one place. Expo's own push service is acceptable for phase 1 internal builds if the backend worker is not ready.

## 4.2 Device registry

`shared.devices (user_id, platform, push_token, app_version, last_seen_at)` plus these columns, accepted in cross-team decision X13:

- `org_id`, so leaving an organisation removes only that organisation's pushes
- `device_id` and `session_id` (FK to the identity `Session`), so revoking a session also stops its pushes
- `locale` and `timezone`, for wording and quiet hours
- `revoked_at`

- The app registers its token after sign-in and whenever the token changes.
- Tokens are revoked on sign-out, on removal from an organisation, and when APNs/FCM report them invalid.
- Tokens not seen for 60 days are pruned.

## 4.3 Kinds of push

Defaults follow Uma's rule ([design 03 §8](../design/03-navigation-ia.md)): **push only for assignments, mentions and deadlines within 24 hours**. Everything else waits for the inbox or email digest unless the user opts in.

| Kind | Example | Default |
|---|---|---|
| Assignment | "DEF-0193 assigned to ABC Plumbing: leaking trap, Unit 305" | On |
| Mention | "Sam mentioned you in RFI-042" | On |
| Deadline within 24 hours | "RFI-042 response due tomorrow" | On |
| SOPA deadline | "Payment schedule for PC-08 is due in 1 business day" | On; can change channel but never turn off (Uma's rule) |
| Approval needed | "VAR-017 is waiting for your approval" | Opt-in |
| Daily AI summary | End-of-day project summary | Opt-in |
| Data changed | Tells the app project X has new data, so it syncs | Silent (content-available / data message) |
| Remote wipe | Tells the app to purge an organisation's data | Silent |

## 4.4 Content and privacy

- Visible pushes carry the minimum: title, short body, and a deep link. Sensitive amounts (claim values) are not shown on the lock screen.
- Payload includes `entity_type`, `entity_id`, `project_id`, `org_id`; tapping opens the matching route (see [01-framework-and-structure.md](01-framework-and-structure.md#12-app-structure)). If the item is not yet on the device, the app syncs that project first, showing a short loading state.
- Messages are grouped per project (iOS thread identifier, Android notification channel and group).
- Android channels: Assignments, Mentions, Approvals, Deadlines, Summaries, so users can tune them in system settings too.

## 4.5 Preferences and noise control

- Per user, per project, per kind, stored in `shared.notification_prefs` (channels `in_app`, `email`, `push`; digest instant, daily or off).
- **Quiet hours** in the user's timezone (default 7 pm to 6 am); non-urgent pushes are held and delivered in the morning digest.
- Collapse keys so repeated updates to the same item replace each other rather than stacking.
- Badge count equals unread in-app notifications, kept in sync on every pull.
- Rate cap per user per hour; anything above it rolls into a digest.

## 4.6 Reliability

- Push is a hint, never the only channel: the in-app inbox (`shared.notifications`) is the source of truth and syncs like other data. In the foreground the app uses the WebSocket from `apps/realtime` instead of push (token sent in the first message; see [01 §1.3](01-framework-and-structure.md#13-sign-in-security-and-licensing-on-the-device)).
- Delivery receipts from APNs/FCM are logged; failures feed token cleanup.
- The push worker is idempotent per notification ID and retries with backoff.
- Load: at 100k users with a peak of perhaps several hundred thousand pushes a day, a few worker processes over HTTP/2 are sufficient; APNs and FCM both support this volume.

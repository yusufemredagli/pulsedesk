# PulseDesk — 90-second recruiter walkthrough

Use a local fictional workspace. Prepare OWNER and AGENT sessions side by side; never show passwords, tokens, browser personal tabs or environment files. This is a script for a real recording, not a link to an existing video or hosted demo.

## Preparation

- Start PostgreSQL, Redis, API, worker and web using the [local runbook](portfolio-demo.md). Confirm `/health`, `/ready` and the visible connected status.
- The five-role seed is supported. OWNER is used for triage/assignment and SLA writes; AGENT handles its assigned/team-accessible work. Do not imply that a full user invitation/role editor exists.
- For a live notification within the recording, use OWNER's existing SLA editor to set the **local demo URGENT first-response target to 1 minute**, keeping a sensible resolution target. Name the policy clearly as a short demo policy. This affects new tickets only; it does not change the source seed defaults or existing deadlines.
- Create an **URGENT** ticket during the walkthrough and do not add a public reply until the first-response deadline has passed. A genuine worker-generated SLA breach notification should appear after the deadline and dispatch latency. Internal comments do not complete first response. An assignment alone is not claimed to generate a new persisted notification.
- Keep a previously seeded alert available as a fallback. If a fresh notification does not arrive in time, explicitly show it as an existing alert; never edit the footage to imply a successful live event that did not occur.

## Recording sequence

| Time    | Action                                                                 | Suggested narration                                                                                                                  |
| ------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 0–8 s   | Login screen; enter OWNER session                                      | “PulseDesk keeps a support request, its owner and response deadline in one workspace.”                                               |
| 8–17 s  | Dashboard                                                              | “These numbers come from fictional local records. Managers can see open work, unassigned requests and SLA state.”                    |
| 17–30 s | New ticket: Demo Müşteri A, a new subject, URGENT                      | “A ticket records customer context and snapshots the current service targets. This one-minute target is only for the local demo.”    |
| 30–42 s | İncele → Ata → Customer Support / Demo Agent                           | “Assignment is an explicit workflow command, with a version check and history.”                                                      |
| 42–55 s | AGENT session: Başlat and an internal note                             | “The agent works within its permission scope. The other session sees the status and comment without a manual reload.”                |
| 55–73 s | Show the owner's reconciled ticket timeline and SLA panel              | “Realtime events trigger a fresh HTTP read. The database remains the source of truth; deadlines and history stay beside the ticket.” |
| 73–85 s | Show the genuine SLA notification when it arrives; open the bell/inbox | “The separate worker detects the missed response target and persists an alert for authorized recipients.”                            |
| 85–90 s | SLA policy or mobile view                                              | “This is a working local demo. The case study links the tenant, concurrency and delivery decisions to the implementation.”           |

The one-minute deadline starts at ticket creation. If creation finishes near 30 seconds, the alert may arrive after the nominal 90-second cut; allow a short edit with an honest elapsed-time caption or show a pre-existing alert as such. Do not reduce the server clock or fabricate notification data to fit the script. Recording a concise 60–90 second explanation is different from claiming all asynchronous timing fits one uncut take.

## Scope boundaries to say accurately

- “Public team comment” stores an application reply and completes first response; it does **not** send email.
- The dashboard is operational data, not a separate analytics/reporting product.
- Team membership and current-role display are not a full user/role administration UI.
- A hosted demo is **deployment pending**. The repository contains the local demo, screenshots and this script.

# 08. Australian privacy and compliance

Owner: Sam. Status: draft v1, 2 Oct 2026. **Not legal advice. Every item marked ⚖ needs confirmation from an Australian privacy/technology lawyer before launch.**
Related: [07 audit logging](07-audit-logging.md), [09 security baseline](09-security-baseline.md), [03 tenant isolation](03-tenant-isolation.md).

## 1. Our position

- We are an **APP entity** under the Privacy Act 1988 (Cth). The small business exemption (turnover ≤ A$3M) may technically apply early on, but ⚖ we should comply fully from day one: enterprise and government-linked builders will require it contractually, the exemption is expected to be narrowed by further reform, and retrofitting privacy is expensive.
- For project data, we act as a **service provider to the builder**: the builder decides what personal information is collected about its workers, subcontractors and clients; we store and process it on their instructions. Our customer agreement and a **Data Processing Addendum** say so. For our own account, billing, marketing and product analytics data, we are the decision-maker.

## 2. Personal information we will hold

| Data | Where | Sensitivity |
|---|---|---|
| User name, email, phone, company, job title | Accounts, directory | Personal |
| Login data: IP, device, location from IP | Sessions, audit log | Personal |
| Site photos (faces), diary labour lists, inductions, licences/tickets (e.g. white card numbers) | Photos, diary, WHS | Personal; licence numbers are government-related identifiers (APP 9: we never use them as our own identifier) |
| Incident reports: injuries, medical treatment | Incidents | **Sensitive information (health)**: APP 3.3 consent/exception required |
| Timesheets, worker GPS check-in (phase 5) | Workforce | Personal; location tracking needs clear notice, workplace surveillance laws in NSW/ACT ⚖ |
| Billing contacts, ABN | Billing | Personal (contacts) |
| AI prompts and outputs | AI assistant | Whatever the user types/uploads |

We do **not** collect tax file numbers, bank details of individuals (payment details go to Stripe), or biometric templates (device biometrics stay on device).

## 3. Australian Privacy Principles: how the product meets them

| APP | Requirement | Product/process response |
|---|---|---|
| 1 Open and transparent | Privacy policy, governance | Public privacy policy, sub-processor list, privacy officer named. Internal privacy impact assessment (PIA) for each new module touching personal info (Incidents, Workforce, AI). |
| 1.7–1.9 (from 10 Dec 2026) | Disclose automated decisions that significantly affect individuals | Privacy policy lists AI features. Design rule: AI drafts and suggests; humans decide. No automated decisions about individuals (e.g. no AI-scored subcontractor prequalification without human review). ⚖ |
| 3 Collection | Only what's reasonably necessary; sensitive info with consent | Minimal required fields. Incidents module captures consent/exception basis and limits health detail to what WHS reporting needs. |
| 5 Notification | Tell people what's collected | Collection notice at signup and in mobile app; builder customers get a template notice for their workers. |
| 6 Use and disclosure | Only for primary purpose | Customer data used only to provide the service. **No training of AI models on customer data.** Product analytics pseudonymised. |
| 7 Direct marketing | Opt-out | Marketing emails separate from transactional, unsubscribe in every one (also Spam Act 2003). |
| 8 Cross-border disclosure | Accountable for overseas recipients | Customer data hosted in AWS Sydney, DR in AWS Melbourne. Offshore sub-processors (Stripe, email provider, error tracking) listed, contractually bound, sent minimum data. AI inference kept in an Australian AWS region where the model is available there; if not, disclosed as cross-border. |
| 10 Quality | Accurate data | Users edit own profile; SCIM keeps enterprise directories in sync. |
| 11 Security | Reasonable steps, incl. technical and organisational measures; destroy when no longer needed | Doc 09 security baseline; retention schedule (doc 07 §6, doc 06 §7); deletion pipeline (doc 03 §8). |
| 12 Access / 13 Correction | Individuals can get and fix their info | Self-service profile + "download my data" for account-level data. Requests about data inside a builder's project are routed to that builder (they control it) with our help, within 30 days. |

## 4. Statutory tort and penalties

The Privacy and Other Legislation Amendment Act 2024 introduced a statutory tort for serious invasions of privacy (in force since June 2025), OAIC infringement notices and tiered civil penalties. Practical impact: misuse of site photos or worker tracking could expose our customers *and* us. Mitigations: tenant isolation (doc 03), photo access governed by permissions, no public links, location features off by default.

## 5. Notifiable Data Breaches (NDB) scheme

Our incident response plan (doc 09 §8) includes:
1. Contain, and start an assessment immediately; finish it within **30 days** at most (statutory maximum), aiming for days.
2. If an eligible data breach (likely serious harm): notify the **OAIC** and affected individuals as soon as practicable.
3. For customer project data, also notify the affected builder(s) promptly (DPA commits to within 72 hours of confirmation), since they may have their own obligations.
4. Record every incident and decision, including ones judged not notifiable.

Related: **Cyber Security Act 2024** requires businesses over A$3M turnover to report ransomware/cyber-extortion payments to the Australian Signals Directorate within 72 hours. Our policy is not to pay; the obligation is still noted in the runbook.

## 6. Other laws and standards that touch this area

| Area | What it means for us |
|---|---|
| Security of Payment Acts (each state) | Evidence records and immutable claim/schedule history (doc 07 §5); deadline reminders keep running in read-only (doc 06). |
| WHS Acts | Builders must keep notifiable incident records for at least 5 years; our retention defaults must not delete them earlier. ⚖ |
| Electronic Transactions Act 1999 (and state equivalents) | Electronic signatures/acceptance of claims and contracts are valid if identity, intent and reliability conditions are met; we record signer identity (authenticated user + step-up auth), intent (explicit "Issue" action) and the sealed document hash. ⚖ |
| Tax (GST Act, ATO record keeping) | Tax invoices and 5-year record retention (doc 05 §5). |
| Australian Consumer Law | Small business customers may get consumer-guarantee protections; terms can't exclude them, and unfair contract terms rules apply to standard-form contracts with small businesses. ⚖ |
| Spam Act 2003 | Consent + unsubscribe for marketing; transactional notifications exempt but kept factual. |
| Workplace surveillance (NSW, ACT) | Before any GPS/geofence timesheet feature, a PIA and customer-facing notice templates. ⚖ |

## 7. Certifications roadmap

Mid-size AU builders increasingly get security questionnaires from clients, and government-funded projects bring stricter requirements.

| When | Target |
|---|---|
| Phase 0–1 | Design to **ASD Essential Eight** maturity level 2 for our corporate environment and to **OWASP ASVS level 2** for the app. Publish a security page and answer standard questionnaires. |
| Before first Enterprise customer | **ISO/IEC 27001** certification (most recognised by AU builders) or **SOC 2 Type II** (if selling to US-linked groups). Recommend ISO 27001 first. |
| When a government-linked customer requires it | **IRAP** assessment against the ISM (needed to hold government data at OFFICIAL: Sensitive / PROTECTED). AWS Sydney regions are already IRAP-assessed at PROTECTED, which helps. |

## 8. Customer-facing documents to produce (later, with a lawyer)

Privacy policy, collection notice, customer terms, Data Processing Addendum, sub-processor list, acceptable use policy, security overview/whitepaper, worker-facing notice template for builders. ⚖ all.

## 9. Privacy by design rules for the team

- Every new feature with personal data: answer "what do we collect, why, who sees it, how long, how is it deleted" in its spec; Sam reviews.
- Defaults are private: no public links, location off, minimal profile fields.
- No personal data in logs, analytics events, error reports or AI prompt logs beyond IDs.
- Test and staging environments never use production personal data.

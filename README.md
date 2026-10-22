[![Built with TideCloak](https://tide.org/badges/built-with-tidecloak.svg)](https://tide.org/tidecloak?utm_source=github&utm_medium=readme&utm_campaign=unlocked)

## Project overview

**Papersec** delivers an unpublished manuscript to exactly one reviewer, for a fixed window — where no single author, administrator or platform operator can open, extend or leak it alone.

Built with [TideCloak](https://tide.org/tidecloak?utm_source=github&utm_medium=readme&utm_campaign=unlocked).

### 1. Vision & originality

A manuscript opens only when four conditions hold at once: the right reader, the right paper, inside the review window, and with **2 of 3 authors agreeing**. What separates this from any sharing platform is where those rules live. They are not enforced by our server code, which we could change — they are enforced by Tide's threshold cryptography, so the people who run Papersec cannot override them either.

### 2. Trust constraint insight

Email, Drive and submission portals all require handing the full text to a provider and its administrators. Worse, **one** careless co-author or one curious admin is enough to leak a draft before publication, costing a research team its scientific priority. Remove the need to trust any single party, and a team can send a draft to an external reviewer without betting on anyone's good behaviour.

### 3. Value & impact

A graduate student sends an unpublished thesis to an examiner at another university for seven days:

- The invitation only takes effect once a supervisor or co-author also approves it (2 of 3).
- The examiner opens **that one manuscript** — not the team's other work — and replies with encrypted feedback only the authors can read.
- After seven days access lapses. Nobody can quietly extend it, including whoever runs the server.

### 4. Why TideCloak matters

| Challenge requirement | How Papersec uses TideCloak |
|---|---|
| **Identity** | Reviewers sign in with Tide; the backend verifies the DPoP-bound token and trusts only the roles inside it |
| **Policy** | Each manuscript has a `RelationshipAttestation:1` policy whose **expiry is sealed by threshold signature** |
| **Approvals** | Granting read access is a change request needing **2 of 3 authors** via Quorum-Enforced Authorization |

The point of the system is what the platform operator *cannot* do:

| Operator attempt | Blocked by |
|---|---|
| Read the disk, dump the database | Ciphertext only — PDFs are encrypted in the author's browser |
| Edit the database to self-grant access | The backend trusts roles in the Tide-signed token, never the database |
| Decrypt while holding both ciphertext and policy | The ORK network refuses: no reader role, no `_tide_decryptor` |
| Extend an expired manuscript via `review_until` | The expiry lives in the signed policy, not in the database |

### 5. Prototype & storytelling

Four role-based views — Author Workspace, Reviewer Inbox, Operator Console, Policy Signing — over three synthetic manuscripts: `p1` shared live, `p2` never shared, `p3` already expired.

**What to look for:** an author invites a reviewer to `p1` and nothing happens until a second author approves. The reviewer then opens `p1`, but gets `403` on `p2` and `p3`. Finally the operator — holding full disk, database and admin access — edits `review_until` to "extend" `p3`: the backend stops blocking, and decryption **still fails**, because the deadline is inside the signed policy. Revocation likewise needs 2 of 3.

**Honest limits.** Tide's ORK network was overloaded during the hackathon, so per the organisers' [Plan C](https://tide.org/unlocked/#plan-c) these protections are **simulated**: `src/lib/mock/` enforces the real rules (quorum, roles, record tags, expiry, token lifetime), but the threshold signatures and the encryption itself are stand-ins, not cryptographic proof. Application code (`src/App.jsx`, `src/lib/api.js`, `src/lib/relationship.js`, `server/**`) is unmodified — `vite.config.js` only redirects four imports in simulation mode. Beyond that: a reader can save or screenshot a PDF once opened, revocation stops *future* access but cannot recall what was already read, and manuscript titles remain server-visible metadata. Measurements and failures are logged in [`docs/VERIFICATION_LOG.md`](docs/VERIFICATION_LOG.md).

## Setup

Requires Node.js ≥ 22.5. **Simulated mode needs nothing else** — no Docker, no Tide network:

```bash
npm install
npm run preview:ui     # http://localhost:5138
```

Each browser **tab** is a different person: open several and sign in as `owner`, `approver2`, `reviewer`, `operator`. The walkthrough is in [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md).

```bash
npm test         # 30 backend tests (self-minted JWT/DPoP)
npm run test:sim # 35 tests of the simulated rules, incl. a full demo run-through
```

<details>
<summary><strong>Live TideCloak integration</strong> (needs Docker and a licensed realm)</summary>

```bash
cp .env.example .env            # licence email, Tide T&C consent, admin password
bash scripts/tide/bootstrap.sh  # container, realm, client, licence, IGA
bash scripts/tide/users.sh      # five identities
bash scripts/tide/pivot.sh      # Papersec roles
bash scripts/tide/invite.sh     # account-linking links — single use each
```

Each person opens their own link in a clean window and creates a **separate** Tide account; one Tide account cannot be linked to two users. Once all five are linked:

```bash
CONFIRM_FLIP=yes bash scripts/tide/finalize.sh   # grants tide-realm-admin — irreversible
node scripts/make-sample-papers.mjs              # three synthetic PDFs
npm run server                                   # API on :8787
npm run dev                                      # app on :5137
```

</details>

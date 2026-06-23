# NoMAD — No More Arbitrary Dates

**A Custom Enterprise Scheduling Solution**

---

## The Problem

Every data operations team knows the pain: hundreds of tickets in a backlog, each with varying workloads, and stakeholders asking "when will this be done?" The answer was always a guess—an arbitrary date picked to satisfy a deadline, not reality.

At Prewave, our data screening team processes thousands of supplier records weekly. Before NoMAD, scheduling looked like this:

- **Spreadsheet chaos**: Manually tracking ticket priority and capacity in disconnected documents
- **Jira friction**: Due dates set optimistically, rarely reflecting actual capacity
- **Invisible bottlenecks**: Large tickets blocking smaller ones, with no visibility into when capacity would free up
- **Constant firefighting**: Stakeholders asking "where's my ticket?" with no clear answer

The result? Missed deadlines, frustrated teams, and planning that felt more like guesswork than strategy.

---

## The Solution

**NoMAD** (No More Arbitrary Dates) is a purpose-built scheduling platform that transforms how teams manage workload and capacity. It's not another project management tool—it's a precision instrument for capacity-aware scheduling.

### What Makes NoMAD Different

**Visual Capacity Planning**
See exactly how much work fits into each week. Drag a ticket onto a week and instantly see whether it fits—or if it needs to span multiple weeks. No more "I think we can squeeze it in."

**Intelligent Ticket Sizing**
Tickets automatically categorize by size (small, medium, large) with reserved capacity for each. This prevents large tickets from starving smaller, quick-win items.

**Bi-Directional Jira Sync**
Lock a ticket to a week, and its due date updates in Jira automatically. If someone changes it in Jira? NoMAD flags the mismatch immediately.

**Real-Time Collaboration**
Multiple team members can work simultaneously. See who's online, watch cursors move, and know instantly when something changes.

**Enterprise-Grade Security**
Single sign-on via Okta, session management, and comprehensive audit logging. Built for enterprise compliance from day one.

---

## Technical Excellence

NoMAD showcases end-to-end software engineering across every layer of the modern stack:

### Architecture Highlights

| Layer | Technology | Why It Matters |
|-------|-----------|----------------|
| **Frontend** | React 18, TypeScript, Tailwind CSS | Modern, type-safe UI with beautiful UX |
| **Backend** | FastAPI (Python), async/await | High-performance API with WebSocket support |
| **Database** | PostgreSQL 15 on Cloud SQL | Enterprise-grade persistence with connection pooling |
| **Infrastructure** | Google Cloud Run, Docker | Serverless scale, zero infrastructure management |
| **Auth** | Okta OIDC, JWT, HttpOnly cookies | Enterprise SSO with defense-in-depth security |
| **Integrations** | Jira Cloud OAuth 2.0, n8n webhooks | Seamless ecosystem connectivity |

### Engineering Decisions That Matter

**Real-Time Without Complexity**
WebSocket-based presence system enables live collaboration without the operational burden of message queues or pub/sub infrastructure.

**Security by Design**
- HttpOnly, Secure, SameSite cookies prevent XSS and CSRF
- Single-tab session enforcement prevents conflicting concurrent edits
- All Jira operations use service account OAuth (no user token storage)
- Comprehensive audit trail for compliance

**Performance at Scale**
- In-memory caching with database write-through
- Async database operations via asyncpg
- Connection pooling for efficient resource utilization
- Silent background refresh to prevent UI interruption

**Developer Experience**
- TypeScript throughout for type safety
- Comprehensive technical documentation
- Migration-based schema evolution
- Docker-based local development matching production

---

## Business Impact

NoMAD transforms operational planning from reactive to proactive:

| Before | After |
|--------|-------|
| "When will this be done?" → "Let me check the spreadsheet" | "When will this be done?" → "Week 3, Friday" |
| Large tickets block everything | Reserved capacity ensures fairness |
| Due dates are wishes | Due dates are commitments |
| Capacity is invisible | Capacity is visualized in real-time |
| Changes happen silently | Changes trigger immediate alerts |

---

## Built By

This application was designed, architected, and implemented end-to-end by a single developer—from identifying the business problem through production deployment on Google Cloud Platform.

**Key competencies demonstrated:**

- **Full-Stack Development**: React/TypeScript frontend, Python/FastAPI backend, PostgreSQL database
- **Cloud Architecture**: Serverless deployment, managed databases, infrastructure-as-code
- **Enterprise Integration**: OAuth 2.0 flows, SSO implementation, third-party API orchestration
- **Security Engineering**: Authentication/authorization design, session management, audit logging
- **UX Design**: Intuitive drag-and-drop interface, real-time feedback, accessibility considerations
- **DevOps**: Docker containerization, CI/CD pipelines, production monitoring

---

## The Bigger Picture

NoMAD isn't just a scheduling tool—it's a demonstration of what's possible when IT leadership combines technical depth with business understanding. The best solutions don't come from vendor catalogs; they come from deeply understanding a problem and building precisely what's needed.

**This is modern IT leadership**: identifying friction, designing solutions, and delivering production-grade software that teams actually want to use.

---

## LinkedIn Summary

> **Built NoMAD, a custom enterprise scheduling platform, from concept to production—React/TypeScript frontend, FastAPI backend, PostgreSQL on GCP, with Okta SSO and real-time Jira integration.** End-to-end software delivery that turned capacity planning from guesswork into precision.

---

*NoMAD is deployed at [nomad.it.prewave.ai](https://nomad.it.prewave.ai) serving the Prewave data operations team.*


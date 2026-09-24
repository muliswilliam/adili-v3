# DIALs - Back-of-the-envelope sizing and database choice

Builds on [dials-scope-and-scale.md](dials-scope-and-scale.md). Every number is an estimate; the assumptions are listed so they can be challenged.

## 1. Assumptions

| Input | Value | Basis |
|---|---|---|
| Declarants (design) | **1.5M** | ~1.2-1.3M today + growth ([scope doc](dials-scope-and-scale.md) §3) |
| Burst headroom | **10x** on peak rates | Deadline behaviour; 2027 triple peak |
| Statements per declaration | 3 | Officer + ~1 spouse + children under 18 |
| Line items per declaration | ~30 | Officer ~15 (income, assets, liabilities), spouse ~10, children ~2 each |
| Declaration size | ~20KB raw JSON, **~50KB on disk** with indexes and TOAST | ~500B per item + bio/household/metadata |
| Versions kept | 1.3x | Submitted version + amendments/clarification corrections (drafts are not versioned) |
| Initial + final declarations | ~150k/year | ~60-100k hires, ~30-60k exits, election years higher |
| Supporting documents | 5 per declarant, ~1MB average after normalising | Title deeds, logbooks, payslips, bank letters |
| Audit events | ~250 per declaration per cycle (declarant + reviewer + system), 0.5KB each | Logins, views, section saves, submits, reviews, access. **Not** every keystroke |
| Biennial window | 61 days (1 Nov - 31 Dec) | Act s.34(2) |
| Peak day | 15% of all filings | Deadline rush |
| Peak hour | 12% of the peak day | Evening before deadline |
| Drafting | ~2 drafters per submitter on peak day, ~1h active per day | Multi-session filling |
| Autosave | Every 30s, only when changed (~50% of the time) | |

## 2. Data volume

### Structured (Postgres)

| Dataset | Per biennial cycle | 10 years | Notes |
|---|---|---|---|
| Declarations (biennial) | ~100GB | ~0.5TB | 1.5M × 50KB × 1.3 |
| Initial + final | ~20GB | ~0.1TB | |
| Line items (if normalised for analytics) | ~45M rows | ~250M rows | Easy with partitioning |
| AI extraction results | ~75GB | ~0.4TB | ~10KB of structured output per document |
| Audit trail | ~450M events, ~225GB | ~1.1TB | **Biggest structured dataset** |
| Roster, tenants, users, reviews, clarifications, access requests, notifications | <10GB | <50GB | Tiny |
| **Total** | **~0.4TB** | **~2.1TB** | Hot set (current + previous cycle) ~0.5TB |

### Per-table breakdown (Postgres only, no file bytes)

Rows per biennial cycle include initial and final declarations (~1.8M declarations/cycle). Row sizes include index overhead. "10y" = 5 cycles; static tables +30% growth; transient tables are peak size (cleared continuously).

| DB | Table | Rows/cycle | Row | GB/cycle | GB 10y |
|---|---|---|---|---|---|
| tenancy | tenants (responsible Commissions + delegates) | 200 | 2K | <0.1 | <0.1 |
| tenancy | org_units (reporting entities, departments; `ltree` path) | 50k | 1K | 0.1 | 0.1 |
| tenancy | officers (roster, one per person) | 1.5M | 1.5K | 2.2 | 3 |
| tenancy | employment_events (appointments, transfers, exits) | 1.8M | 0.5K | 0.9 | 4 |
| tenancy | filing_obligations (who owes which declaration, due date) | 1.8M | 0.4K | 0.7 | 4 |
| keycloak | users, credentials, roles, org membership | 1.6M | 3K | 4.8 | 6 |
| declarations | declarations (header, type, status) | 1.8M | 1K | 1.8 | 9 |
| declarations | declaration_versions (JSONB legal snapshot) | 2.3M | 20K | 47 | 234 |
| declarations | household_members (spouses, children) | 3.6M | 0.5K | 1.8 | 9 |
| declarations | financial_statements (one per person) | 5.4M | 0.4K | 2.2 | 11 |
| declarations | declaration_items (income, assets, liabilities) | 54M | 0.7K | 38 | 189 |
| declarations | material_changes (vs previous declaration) | 5.4M | 0.4K | 2.2 | 11 |
| declarations | acknowledgements (receipts) | 1.8M | 0.4K | 0.7 | 4 |
| declarations | document_refs (metadata only) | 7.5M | 0.5K | 3.8 | 19 |
| declarations | drafts (per section, deleted on submit) | 1.5M | 20K | 30 (transient) | 30 |
| review | review_cases | 1.8M | 0.6K | 1.1 | 5 |
| review | risk_flags (rules + AI, with explanation) | 5.4M | 1K | 5.4 | 27 |
| review | clarification requests + responses | 360k | 2K | 0.7 | 4 |
| review | compliance_decisions | 1.8M | 0.4K | 0.7 | 4 |
| review | administrative_actions | 90k | 0.6K | 0.1 | 0.3 |
| intelligence | ai_extractions (structured output per document) | 7.5M | 10K | 75 | 375 |
| integration | verification_results (KRA, NTSA, BRS, ArdhiSasa, IPRS) | 7.5M | 2K | 15 | 75 |
| access | Form K requests, representations, decisions | 10k | 5K | <0.1 | 0.3 |
| reporting | Form M reports + non-filer lists | 150k | 0.5K | <0.1 | 0.4 |
| notifications | reminders, SMS/email log | 15M | 0.5K | 7.5 | 38 |
| audit | audit_events (hash-chained, reads + writes) | 450M | 0.5K | 225 | 1,125 |
| temporal | workflow histories (kept 30 days after close) | 1.8M | 20K | 36 (transient) | 36 |

| DB | Rows/cycle | GB/cycle | GB 10y | Share |
|---|---|---|---|---|
| audit | 450M | 225 | 1,125 | ~50% |
| declarations | 83M | 127 | 515 | ~25% |
| intelligence | 7.5M | 75 | 375 | ~15% |
| temporal | 1.8M | 36 | 36 | transient |
| integration | 7.5M | 15 | 75 | |
| review | 9.4M | 8 | 40 | |
| notifications | 15M | 7.5 | 38 | |
| keycloak + tenancy | 6.8M | 9 | 17 | |
| access + reporting | 0.2M | 0.2 | 1 | |
| **Total** | **~580M** | **~500GB** | **~2.2TB** | |

Takeaways:
- **Audit is half of all structured data.** It is append-only, so monthly partitions + archive to object storage keep the live database small.
- The **core legal data** (roster, declarations, reviews, access, Form M) is only ~140GB per cycle.
- AI extractions and verification results are re-creatable caches: they can be kept shorter or archived.
- Leaving out audit archive and caches, the live Postgres footprint stays **under ~1TB even after 10 years**.

### Objects (S3-compatible storage)

| Dataset | Per cycle | 10 years (logical) | Raw with erasure coding 4+2 (1.5x) |
|---|---|---|---|
| Supporting documents | 7.5M files, **~7.5TB** | ~40TB | ~60TB |
| Derivatives (thumbnails, OCR text, generated PDFs/slips, Form M) | ~0.8TB | ~4TB | ~6TB |
| Audit archive (Parquet, object-locked) | ~50GB compressed | ~0.3TB | |
| Postgres backups (full + WAL) | | ~2x DB size | Off-site copy in DR site |

**Documents are about 95% of the bytes.** The object store is the component that really has to scale, not the database.

## 3. Traffic at peak (December deadline)

| Metric | Nominal peak | With 10x headroom | Hits |
|---|---|---|---|
| Submissions | 225k/day, 27k/h, **7.5/s** | **75/s** | Postgres (transaction + outbox) |
| Concurrent drafters | ~54k | design 100k, stress 250k | App tier |
| Autosaves | ~900/s | **1.7k-4.2k/s** | **Valkey**, write-behind to Postgres |
| API requests | ~5k rps | ~10-25k rps | Traefik → stateless NestJS; mostly cache hits |
| Document uploads | 37/s, ~37MB/s (~300Mbps) | **~3Gbps ingress** | Object store via presigned URLs (bypass app servers) |
| OCR/AI extraction | 37 docs/s at peak, **1.4/s average** over the window | | Queue-buffered; 2-4 GPUs catch up overnight |
| Integration lookups (KRA, NTSA, BRS, ArdhiSasa, IPRS) | ~5 per declaration → 7.5M calls/cycle | | Async, queued, cached, rate-limited per external system |
| Form M / dashboards | ~160 Commission reports + national rollup | | Materialised views on a read replica |

Draft memory in Valkey: 100k concurrent drafts × 50KB = **~5GB**. Keeping all 1.5M unsubmitted drafts in Valkey would be ~75GB, so drafts are flushed to Postgres (per-section rows) every few minutes or when a section is completed, and evicted after an hour of inactivity.

### Data flowing into Postgres (no file bytes)

| Window | Data written | Rate |
|---|---|---|
| Whole 2-year cycle | ~500GB | ~0.7GB/day average |
| Biennial window (Nov-Dec, ~80% of the cycle's data) | ~400GB | ~6.5GB/day |
| Peak day | ~60GB | |
| Peak hour | ~7GB | **~2MB/s** nominal, **~20MB/s** at 10x |

| Write stream | Nominal peak | Stress (10x / 250k drafters) |
|---|---|---|
| Submissions (~70 rows each, one transaction) | 7.5/s → ~500 rows/s | 75/s → ~5k rows/s |
| Audit events (batched from queue) | ~1.5k/s | ~7k/s |
| Draft flushes from Valkey (every ~3 min per drafter, ~3KB) | ~300/s, ~1MB/s | ~1.4k/s, ~4MB/s |
| Review / AI / integration results | queue-smoothed, ~1-40/s | same (backlog drains overnight) |
| DB reads (after ~80% cache hits) | ~2k qps | ~5k qps, mostly on replicas |
| WAL generated (backup + replication traffic) | ~150GB on peak day | |

## 4. What the workload looks like

1. **Small, relational core:** roster ↔ employer ↔ responsible Commission ↔ declarations ↔ reviews ↔ clarifications ↔ actions. Every key output is a join or aggregate:
   - Form M "who did not file" = anti-join of the roster against submissions per Commission and cycle
   - Reviewer queues = filter by tenant + status + risk + deadline
   - Material change = compare with the previous declaration of the same person (possibly held by another tenant)
   - EACC consolidation = group-by across all tenants
2. **Legal record:** a submission must be atomic (declaration + status + acknowledgement + audit + outbox event), strongly consistent, and immutable afterwards.
3. **Multi-tenant isolation:** ~160 tenants plus delegates; row-level security in the database is the strongest guarantee.
4. **Bursty but modest writes:** tens per second for durable records, a few thousand per second for drafts (absorbed by the cache).
5. **Append-heavy audit:** the only high-volume dataset, and ~1.5k events/s at nominal peak, ~7k/s at the 250k-drafter stress case (batched inserts from a queue).

## 5. Postgres vs Cassandra against these numbers

| Requirement | PostgreSQL | Apache Cassandra |
|---|---|---|
| Durable write rate needed (~75/s submissions, ~1.5k-7k/s batched audit) | Comfortable; one tuned primary on NVMe does 10k+ simple writes/s, far more with batched COPY | Built for 10k-100k+/s per node, **far more than we need** |
| Data size (~0.5TB hot, ~2TB in 10 years) | Well within one cluster; partitioning keeps indexes small | Designed for 10s-100s of TB |
| Form M anti-joins, reviewer queues, national aggregates | Native SQL, materialised views | No joins or ad-hoc aggregation; needs a table per query plus Spark/extra pipeline |
| Atomic submit (declaration + status + audit + outbox) | ACID transaction | No multi-table transactions; lightweight transactions (LWT) are slow and single-partition |
| Strong consistency for a legal record | Default | Tunable, eventual by default |
| Tenant isolation | Row-level security | App-enforced only |
| Hierarchy queries (Commission → entity → department) | `ltree` / recursive CTEs | Denormalise everything |
| Point-in-time recovery | pgBackRest / WAL, well-known | Snapshots + incremental; harder to restore to an exact moment |
| Ops burden | One technology we already need for identity, Temporal and Keycloak | Second database: ≥3 nodes per DC, repairs, compaction, JVM tuning |
| Consistency between the two stores | n/a | Declarations in Cassandra + roster in Postgres = cross-database sagas for every Form M |
| How judges read it | Right-sized, justified by numbers | Risk of looking like over-engineering |

**Where Cassandra would win:** sustained write rates of tens of thousands per second, 100TB+ of structured data, or multi-master writes across data centres. None of these apply. Even the audit trail peaks around 7k events/s in the stress case, on its own cluster, batched.

## 6. Recommendation

**PostgreSQL for all structured data. Drop Cassandra.**

- **Database per service** (logical separation; separate clusters in production for the heavy ones):
  - `declarations` - JSONB document per declaration version (the legal snapshot) + normalised `declaration_items` for analytics and material-change comparison. List-partitioned by cycle.
  - `audit` - append-only, hash-chained, range-partitioned by month. Keep 24 months hot; export older partitions to Parquet in object-locked storage.
  - `identity/tenancy`, `review`, `access`, `reporting`, `notifications` - small.
  - Keycloak and Temporal each get their own database.
- **Row-level security** keyed on tenant; `ltree` for the hierarchy.
- **Valkey** for drafts (write-behind), sessions, rate limits, reference data cache.
- **PgBouncer** in front of each cluster (many microservice replicas × connection pools).
- **Read replicas** for reviewer search, dashboards and Form M.
- **Growth path, only if the numbers change:** Citus to shard by tenant, and a columnar store (ClickHouse, or Parquet + DuckDB) for EACC national analytics. Neither is needed for the demo or the first cycles.

### Production footprint (first two cycles)

| Component | Size |
|---|---|
| Postgres `declarations` cluster | 3 nodes (Patroni), 16-32 vCPU, 128GB RAM, 2TB NVMe each; async replica in DR site |
| Postgres `audit` cluster | 3 nodes, 8-16 vCPU, 64GB RAM, 2-4TB NVMe |
| Postgres shared small-services cluster | 3 nodes, 8 vCPU, 32GB RAM |
| Valkey | 3 nodes (Sentinel), 32GB RAM each |
| Object store (Ceph RGW) | 6+ nodes, ~25TB usable for 2 cycles (EC 4+2 → ~40TB raw), replicated to DR site |
| AI | 2-4 GPUs (24-48GB) for vLLM + OCR workers |
| App tier | Stateless containers, horizontal autoscale; ~20-40 replicas at peak |
| Network | 10Gbps internal, ≥3Gbps edge for upload bursts |

For the hackathon: one Postgres, one Valkey, one S3-compatible store, all on Dokploy. Same schema and partitioning, so the demo shows the production design at small scale.

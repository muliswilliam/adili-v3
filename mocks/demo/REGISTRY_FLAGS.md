# Demo registry flags

Seeded records are keyed by national ID. Spec 05b uses the **matches** as pre-fill suggestions. Spec 07b raises **flags** when a registry record is missing from the declaration (indicators, never findings).

| Person | National ID | Role | What the registries hold | Demo use |
| --- | --- | --- | --- | --- |
| Wanjiku Njoki Kamau | 27451863 | Declarant (KEMSA) | KRA PIN A004518637K, compliant. NTSA: KCX 214J Fielder (2016), KDK 482M Prado (2023). ArdhiSasa: Kiambu Ruiru 0.045 ha, Kajiado Kitengela 2.0235 ha. BRS: director (400 shares) of Afya Bora Medical Supplies (`PVT-9XYZ2L4Q`). HR: that company supplies KEMSA. | **05b match:** declare the Fielder and the Kiambu parcel. **07b undeclared vehicle:** Prado. **07b undeclared parcel:** Kajiado. **07b supplier-directorship:** Afya Bora supplies her employer. |
| Peter Mwangi Kamau | 24718355 | Spouse | KRA PIN A002471835M. NTSA: KCB 903T Mazda CX-5. BRS: director (600 shares) of Afya Bora. No public employment. | Household suggestions / spouse assets. |
| Imani Wairimu Kamau | 40731125 | Child | IPRS only | No registry flags. |
| Baraka Kariuki Kamau | 40731126 | Child | IPRS only | No registry flags. |
| Otieno Juma Odhiambo | 30194427 | Declarant (MOH) | KRA compliant. No vehicles, parcels or companies. | Clean 05b / 07b baseline. |
| Achieng Atieno Njeri | 28836510 | Declarant (PSC) | KRA compliant. No vehicles, parcels or companies. | Clean 05b / 07b baseline. |
| Kiprono Kibet Chebet | 22607781 | Declarant (PSC) | KRA PIN A002260778R, **non-compliant**. NTSA: KDA 118Q X-Trail. ArdhiSasa: Nairobi Block 82 leasehold. BRS: 250 shares in Rift Valley Agrovet. | **07b tax non-compliance.** Vehicle and parcel for his own filing. |
| Amina Halima Hassan | 31552094 | Declarant (PSC) | KRA compliant. Empty NTSA, BRS and ArdhiSasa lists. | Clean officer; empty lists are matches, not flags. |
| Daniel Kiprop Rotich (roster) / Samuel Kiprotich Langat (IPRS) | 38221907 | PSC roster only | IPRS holds another name for the ID. | **Spec 03 identity mismatch** at onboarding. |

Pause a registry for 07b unavailable / breaker tests:

```
POST /demo/registries/kra/pause
POST /demo/registries/kra/resume
```

`GET /demo/registries/kra` reports the current state. `MOCK_KRA_PAUSED=true` (same for `NTSA`, `BRS`, `ARDHISASA`) only sets the starting state: pause and resume override it, and the override is stored in the mocks database so it survives reloads and applies to every worker.

Per-request overrides: `X-Mock-Failure=timeout|unavailable|error` (case-insensitive), `X-Mock-Latency-Ms` and `X-Mock-Rate-Limited=1`. Every registry response includes `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` (seconds until the window resets; wait that long on 429). The limit is `MOCK_REGISTRY_RATE_LIMIT` per minute (default 60), counted in memory per process, so it resets on reload and each gunicorn worker counts on its own.

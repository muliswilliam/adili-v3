/**
 * Makes Zod jitless on the page, for the apps' CSP (script-src with a nonce and 'strict-dynamic',
 * no 'unsafe-eval'). Zod 4 compiles a fast path for each object schema with `new Function` once a
 * probe says it may, and the browser reports that probe as a CSP violation even though Zod catches
 * the error (#686).
 *
 * `z.config({ jitless: true })` in the client entry would run too late: the entry's imports, which
 * build schemas (and so probe), run before its body. This head script runs before any module and
 * sets the config every copy of Zod 4 reads when it loads (`globalThis.__zod_globalConfig`).
 * scripts/smoke-csp.mjs fails if a Zod upgrade stops honouring it.
 */
export const ZOD_JITLESS_SCRIPT =
  'globalThis.__zod_globalConfig=Object.assign(globalThis.__zod_globalConfig||{},{jitless:true});';

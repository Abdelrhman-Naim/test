// Canonical network protections stay in network.ts, shared by old/new collectors.
// No separate resolver, IP policy or HTTP implementation lives in this facade.
export {SsrfBlockedError,resolveAndValidate,safeFetch,safeFetchPage} from '../src/lib/network';
export type {ResolvedTarget,ResourceOptions} from '../src/lib/network';

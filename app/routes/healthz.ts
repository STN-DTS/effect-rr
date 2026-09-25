/** Liveness probe used by the container HEALTHCHECK. Resource route: no UI. */
export function loader() {
  return Response.json({ status: 'ok' }, { headers: { 'cache-control': 'no-store' } });
}

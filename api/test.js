export default function handler(req) {
  console.log("test handler called", typeof req, req?.constructor?.name, req?.url);
  return new Response(JSON.stringify({
    ok: true,
    reqType: typeof req,
    reqConstructor: req?.constructor?.name,
    reqUrl: req?.url ?? null,
    isRequest: req instanceof Request,
  }), {
    headers: { "content-type": "application/json" },
  });
}

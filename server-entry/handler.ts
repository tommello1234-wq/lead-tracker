/**
 * Vercel Function entry — captura todas as rotas /api/* via catch-all
 * `api/[[...route]].js` (gerado pelo esbuild bundle).
 *
 * Vercel detecta automaticamente um default export com `.fetch` method
 * e usa como Web Standard handler. Hono `app` já tem `.fetch`, então
 * basta `export default app`.
 *
 * Ver: https://vercel.com/docs/functions/functions-api-reference#fetch-web-standard-handler
 */
import { app } from "../server/app.js";

export default app;

/**
 * Un faux Firebase derrière un petit serveur HTTP sur cette machine, pour les essais en navigateur : le jeu y est dirigé par
 * `?debug&cloud=http://127.0.0.1:PORT` (voir src/cloud/config.ts). C'est le même faux serveur que celui des essais unitaires
 * (tests/support/fakeFirebase.ts), chargé par Vite.
 */
import { createServer as createHttp } from 'node:http';
import { createServer as createVite } from 'vite';

export async function startFakeFirebase() {
  const vite = await createVite({ logLevel: 'silent', server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', optimizeDeps: { noDiscovery: true } });
  const { FakeFirebase } = await vite.ssrLoadModule('/tests/support/fakeFirebase.ts');
  // Le projet Firebase est-il renseigné dans le jeu (src/cloud/config.ts) ? Les essais s'y adaptent.
  const { FIREBASE } = await vite.ssrLoadModule('/src/cloud/config.ts');
  const fake = new FakeFirebase();
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,content-type', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'Access-Control-Max-Age': '600' };
  const http = createHttp((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      res.end();
      return;
    }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      // Réseau coupé : la connexion tombe, comme pour un téléphone sans réseau.
      if (fake.down) {
        req.socket.destroy();
        return;
      }
      const out = fake.handle({ method: req.method, url: `http://${req.headers.host}${req.url}`, headers: req.headers, body });
      res.writeHead(out.status, { ...cors, 'Content-Type': 'application/json' });
      res.end(out.body);
    });
  });
  await new Promise((ok) => http.listen(0, '127.0.0.1', ok));
  const port = http.address().port;
  return {
    fake,
    configured: !!(FIREBASE.apiKey && FIREBASE.projectId),
    url: `http://127.0.0.1:${port}`,
    async close() {
      http.closeAllConnections?.();
      http.close();
      await vite.close();
    },
  };
}

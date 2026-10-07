/**
 * Vérifie le client MQTT maison contre un vrai courtier (aedes) lancé en local :
 *   npx vite-node tests-net/mqtt.check.ts
 * (Les courtiers publics ne sont pas joignables depuis tous les environnements ; celui-ci l'est toujours.)
 */
import { Aedes } from 'aedes';
import { createServer } from 'aedes-server-factory';
import WebSocket from 'ws';
import { MqttTransport } from '../src/net/mqtt';
import type { Message } from '../src/net/transport';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const ok = (c: boolean, label: string) => {
  console.log(c ? '✔' : '✘', label);
  if (!c) failures++;
};

async function startBroker(): Promise<{ port: number; close: () => Promise<void>; messages: () => number }> {
  const broker = await Aedes.createBroker();
  let count = 0;
  broker.on('publish', (p) => {
    if (!p.topic.startsWith('$')) count++;
  });
  const server = createServer(broker, { ws: true });
  await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()));
  const port = (server.address() as { port: number }).port;
  return {
    port,
    messages: () => count,
    close: () =>
      new Promise((res) => {
        broker.close(() => server.close(() => res()));
      }),
  };
}

const make = (url: string) => new WebSocket(url, 'mqtt') as unknown as globalThis.WebSocket;

const b1 = await startBroker();
const b2 = await startBroker();
const urls = [`ws://127.0.0.1:${b1.port}`, `ws://127.0.0.1:${b2.port}`];

const a = new MqttTransport('TEST1', { brokers: urls, makeSocket: make });
const b = new MqttTransport('TEST1', { brokers: urls, makeSocket: make });
const other = new MqttTransport('AUTRE', { brokers: urls, makeSocket: make });
const gotA: Message[] = [];
const gotB: Message[] = [];
const gotOther: Message[] = [];
a.onMessage = (m) => gotA.push(m);
b.onMessage = (m) => gotB.push(m);
other.onMessage = (m) => gotOther.push(m);
let statusA = '';
a.onStatus = (s) => (statusA = s);

for (let i = 0; i < 50 && (a.openCount < 2 || b.openCount < 2 || other.openCount < 2); i++) await sleep(50);
ok(a.openCount === 2 && b.openCount === 2, 'les deux transports sont abonnés aux deux courtiers');
ok(statusA === 'open', 'le statut passe à « open »');

a.send({ m: 'hello', n: 'amie', big: 'x'.repeat(40000) });
b.send({ m: 'welcome', v: 1 });
await sleep(300);
ok(gotB.length === 1 && gotB[0].m === 'hello' && (gotB[0].big as string).length === 40000, 'un message de 40 ko traverse le courtier (une seule fois malgré deux courtiers)');
ok(gotA.length === 1 && gotA[0].m === 'welcome', 'la réponse revient (et son propre écho est ignoré)');
ok(gotOther.length === 0, 'une autre partie (autre code) n’entend rien');

// Beaucoup de petits messages à la suite, dans l'ordre.
for (let i = 0; i < 300; i++) a.send({ m: 'f', i });
await sleep(500);
const seq = gotB.filter((m) => m.m === 'f').map((m) => m.i as number);
ok(seq.length === 300, `300 messages reçus (${seq.length})`);
ok(seq.every((v, i) => v === i), 'dans l’ordre');

// Un courtier tombe : la partie continue par l'autre.
await b1.close();
await sleep(200);
a.send({ m: 'after', k: 1 });
await sleep(300);
ok(gotB.some((m) => m.m === 'after'), 'un courtier disparu : les messages passent par l’autre');
ok(a.openCount === 1, 'le transport sait qu’un seul courtier reste');

// Rétablissement : on relance un courtier au même port ? (le client réessaie tout seul ; vérifié simplement par l'absence d'exception)
a.close();
b.close();
other.close();
await b2.close();
console.log(failures ? `${failures} échec(s)` : 'MQTT validé.');
process.exit(failures ? 1 : 0);

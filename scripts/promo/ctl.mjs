// Talk to a running promo app (app.cjs) from the command line or a scene script.
//   node scripts/promo/ctl.mjs shot out.png
//   node scripts/promo/ctl.mjs eval "document.title"
import path from 'node:path';

const PORT = process.env.PROMO_CONTROL || 47800;

export async function ctl(route, body = {}) {
  const res = await fetch(`http://127.0.0.1:${PORT}/${route}`, { method: 'POST', body: JSON.stringify(body) });
  const data = await res.json();
  if (data && data.error) throw new Error(`${route}: ${data.error}`);
  return data;
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const [cmd, ...rest] = process.argv.slice(2);
  let out;
  if (cmd === 'shot') out = await ctl('shot', { file: path.resolve(rest[0]) });
  else if (cmd === 'eval') out = await ctl('eval', { js: rest.join(' ') });
  else if (cmd === 'log') out = await ctl('mock/log');
  else out = await ctl(cmd, rest[0] ? JSON.parse(rest[0]) : {});
  console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 2));
}

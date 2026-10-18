import http from 'node:http';
import { listOrders } from './routes/orders.js';

http.createServer(async (req, res) => {
  if (req.url === '/orders') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(await listOrders()));
  }
  res.writeHead(404).end();
}).listen(3000, () => console.log('storefront-api on http://localhost:3000'));

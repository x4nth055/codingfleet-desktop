'use strict';
// Where the API is. The key is not kept here: the desktop app stores it,
// encrypted, from its Settings, and the CLI will read it from its own config.
// Environment variables win over both; that is how tests reach a local server:
//   CODINGFLEET_API_BASE=http://127.0.0.1:8010/v1 CODINGFLEET_API_KEY=cf_sk_... npm start
const DEFAULT_API_BASE = 'https://codingfleet.com/v1';

module.exports = {
  DEFAULT_API_BASE,
  ENV_API_BASE: process.env.CODINGFLEET_API_BASE || null,
  ENV_API_KEY: process.env.CODINGFLEET_API_KEY || null,
};

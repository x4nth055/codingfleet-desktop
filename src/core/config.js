'use strict';
// Where the API is: always codingfleet.com for users. The key is not kept
// here: the desktop app stores it, encrypted, from its Settings, and the CLI
// will read it from its own config. An environment key wins over both:
//   CODINGFLEET_API_KEY=cf_sk_... npm start
// (CODINGFLEET_API_BASE is for CodingFleet's own developers.)
const DEFAULT_API_BASE = 'https://codingfleet.com/v1';

module.exports = {
  DEFAULT_API_BASE,
  ENV_API_BASE: process.env.CODINGFLEET_API_BASE || null,
  ENV_API_KEY: process.env.CODINGFLEET_API_KEY || null,
};

'use strict';
// Staying awake while the agent works.
//
// A laptop with Modern Standby goes into standby a few minutes after its
// screen turns off on idle, and Windows then freezes desktop apps: no
// heartbeat reaches the server, the tool call waiting on this computer times
// out, and the agent is told to give up. A power request ('prevent-app-
// suspension', PowerRequestExecutionRequired on Windows) keeps the computer in
// "screen off, still running" while any run is going.
//
// What it does not do, on purpose: keep the screen on, or overrule the user.
// Closing the lid, the power button and Sleep in the Start menu still put the
// computer to sleep; Windows ends app requests on a sleep the user asked for.
// On battery Windows honours the request for 5 minutes past the sleep timeout.

/** @param {{ start: Function, stop: Function, isStarted: Function }} blocker Electron's powerSaveBlocker. */
function createAwake(blocker) {
  let id = null;
  return {
    /** Hold the request while `busy` and allowed; release it otherwise. */
    sync(busy, allowed = true) {
      const wanted = Boolean(busy) && allowed !== false;
      if (wanted && id === null) {
        id = blocker.start('prevent-app-suspension');
      } else if (!wanted && id !== null) {
        if (blocker.isStarted(id)) blocker.stop(id);
        id = null;
      }
      return id !== null;
    },
    get held() { return id !== null; },
  };
}

module.exports = { createAwake };

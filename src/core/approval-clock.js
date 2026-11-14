'use strict';
// How long an approval waits for an answer before the agent is told nobody
// answered and goes on without that call. The server gives up on a call after
// 30 minutes and stops the whole run (CLIENT_TOOL_MAX_WAIT in
// client_executor.py); the app answers first, so the rest of the work goes on
// while the user is away and only the call that needed them is left undone.
//
// Each approval in a session that times out makes the next one wait less:
// 10, 5, 3 and then 1 minute, so five risky commands in a row hold the run
// 20 minutes, not 50. Someone who answers an approval or sends a message is
// back, and the next approval waits the full 10 minutes again.

const WAIT_MINUTES = [10, 5, 3, 1];

/** Minutes the next approval waits, after `missed` approvals nobody answered. */
const waitMinutes = (missed) => WAIT_MINUTES[Math.min(Math.max(0, missed || 0), WAIT_MINUTES.length - 1)];

/** The tool result the agent gets for a call nobody approved in time. */
function unansweredOutput(reason, minutes) {
  const unit = minutes === 1 ? 'minute' : 'minutes';
  return `Not run: this needed the user's approval (it ${reason || 'needs approval'}) and nobody answered `
    + `within ${minutes} ${unit}; they may be away. Carry on with the work, and at the end say what you `
    + 'left undone and what it would do.';
}

/**
 * @param {object} [o]
 * @param {(fn: Function, ms: number) => any} [o.setTimer]
 * @param {(handle: any) => void} [o.clearTimer]
 * @param {number} [o.minuteMs] One minute, shorter in tests.
 */
function createApprovalClock({ setTimer = setTimeout, clearTimer = clearTimeout, minuteMs = 60000 } = {}) {
  const missed = new Map(); // session id -> approvals nobody answered since the user was last here

  return {
    /**
     * Starts the wait of one approval. `onExpire(minutes)` runs once if it
     * times out; the returned stop() cancels it (answered, or the run ended).
     */
    start(sessionId, onExpire) {
      const minutes = waitMinutes(missed.get(sessionId));
      let done = false;
      const handle = setTimer(() => {
        if (done) return;
        done = true;
        missed.set(sessionId, (missed.get(sessionId) || 0) + 1);
        onExpire(minutes);
      }, minutes * minuteMs);
      return {
        minutes,
        stop() {
          if (done) return;
          done = true;
          clearTimer(handle);
        },
      };
    },
    /** The user is here (answered an approval, sent a message): the next wait is the full one. */
    present(sessionId) { missed.delete(sessionId); },
    missed: (sessionId) => missed.get(sessionId) || 0,
  };
}

module.exports = { createApprovalClock, waitMinutes, unansweredOutput, WAIT_MINUTES };

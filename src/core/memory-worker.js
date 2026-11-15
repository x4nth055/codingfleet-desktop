'use strict';
// The thread that does project memory's file work for every project at once
// (memory-jobs.js). One job at a time, in the order they arrive.
const { parentPort } = require('worker_threads');
const { runJob } = require('./memory-jobs');

parentPort.on('message', ({ id, job }) => {
  try {
    parentPort.postMessage({ id, result: runJob(job) });
  } catch (err) {
    parentPort.postMessage({ id, error: String((err && err.message) || err) });
  }
});

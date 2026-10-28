'use strict';
const { spawn } = require('node:child_process');

/** Run directly, never through a shell. Keep bounded diagnostics and streaming logs. */
function runSolver(executable, args, options, token, onOutput) {
  return new Promise((resolve, reject) => {
    let child, timer, killTimer, subscription;
    let output = '', stopped = false, timedOut = false, settled = false;
    const finish = (error, code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); clearTimeout(killTimer); subscription?.dispose();
      if (error) reject(error);
      else resolve({ code, output, cancelled: stopped, timedOut });
    };
    const stop = () => {
      if (settled || stopped) return;
      stopped = true;
      child.kill();
      killTimer = setTimeout(() => child.kill('SIGKILL'), 1000);
    };
    try {
      child = spawn(executable, args, { cwd: options.cwd, shell: false, windowsHide: true });
      const receive = chunk => {
        const value = chunk.toString();
        output = (output + value).slice(-1024 * 1024);
        onOutput(value);
      };
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stdout.on('data', receive); child.stderr.on('data', receive);
      child.once('error', error => finish(error));
      child.once('close', code => finish(null, code));
      subscription = token.onCancellationRequested(stop);
      timer = setTimeout(() => { timedOut = true; stop(); }, options.timeoutMs);
      if (token.isCancellationRequested) stop();
    } catch (error) { finish(error); }
  });
}
module.exports = { runSolver };

'use strict';

// A run-only DAP adapter: use VS Code's launch configuration and Stop controls.
class RunDebugAdapter {
  constructor(execute, emitter, cancellation) {
    this.execute = execute;
    this.emitter = emitter;
    this.cancellation = cancellation;
    this.onDidSendMessage = emitter.event;
    this.sequence = 1;
    this.started = false;
    this.finished = false;
  }
  send(message) { this.emitter.fire({ ...message, seq: this.sequence++ }); }
  event(event, body = {}) { this.send({ type: 'event', event, body }); }
  reply(request, body = {}, error) {
    this.send({ type: 'response', request_seq: request.seq, command: request.command,
      success: !error, body, ...(error ? { message: error } : {}) });
  }
  finish(code) {
    if (this.finished) return;
    this.finished = true;
    this.event('exited', { exitCode: code });
    this.event('terminated');
  }
  handleMessage(request) {
    if (request.type !== 'request') return;
    switch (request.command) {
      case 'initialize':
        this.reply(request, { supportsConfigurationDoneRequest: false, supportsTerminateRequest: true });
        this.event('initialized');
        break;
      case 'launch':
        if (this.started) { this.reply(request, {}, '実行は既に開始されています。'); break; }
        this.started = true;
        this.reply(request);
        Promise.resolve().then(() => this.execute(request.arguments, this.cancellation.token,
          text => this.event('output', { category: 'stdout', output: text })))
          .then(result => this.finish(result?.cancelled ? 130 : (result?.code ?? 1)))
          .catch(error => { this.event('output', { category: 'stderr', output: `${error.message}\n` }); this.finish(1); });
        break;
      case 'disconnect':
      case 'terminate':
        this.cancellation.cancel();
        this.reply(request);
        if (!this.started) this.finish(130);
        break;
      case 'threads': this.reply(request, { threads: [] }); break;
      case 'setBreakpoints': this.reply(request, { breakpoints: (request.arguments?.breakpoints || []).map(() => ({ verified: false })) }); break;
      case 'setExceptionBreakpoints':
      case 'configurationDone': this.reply(request); break;
      default: this.reply(request, {}, 'MathProg はモデルの実行・検査に対応しています。ステップ実行はできません。');
    }
  }
  dispose() { this.cancellation.cancel(); this.cancellation.dispose(); this.emitter.dispose(); }
}
module.exports = { RunDebugAdapter };

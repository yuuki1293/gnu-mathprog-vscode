'use strict';

// Serialize background checks and discard results made obsolete by editing or selection changes.
class AnalysisScheduler {
  constructor({ enabled = true, delay = 500, createCancellation, analyze, publish, clear, status }) {
    Object.assign(this, { enabled, delay, createCancellation, analyze, publish, clear, status });
    this.generation = 0;
    this.suspensions = 0;
    this.disposed = false;
  }
  invalidate(state = 'waiting') {
    if (this.disposed) return;
    this.generation++;
    clearTimeout(this.timer);
    this.cancellation?.cancel();
    this.clear();
    this.status(this.enabled ? state : 'off');
  }
  schedule() {
    if (this.disposed) return;
    this.invalidate(this.suspensions ? 'paused' : 'waiting');
    if (!this.enabled || this.disposed || this.suspensions) return;
    const generation = this.generation;
    this.timer = setTimeout(() => { void this.start(generation); }, this.delay);
  }
  async start(generation) {
    await this.running;
    if (this.disposed || !this.enabled || this.suspensions || generation !== this.generation) return;
    const cancellation = this.createCancellation();
    this.cancellation = cancellation;
    this.status('running');
    const task = Promise.resolve().then(() => this.analyze(cancellation.token)).then(result => {
      if (!this.disposed && this.enabled && generation === this.generation && !cancellation.token.isCancellationRequested) this.publish(result);
    }).catch(error => {
      if (!this.disposed && this.enabled && generation === this.generation) this.status('error', error.message);
    }).finally(() => { cancellation.dispose(); if (this.cancellation === cancellation) this.cancellation = undefined; });
    this.running = task;
    await task;
    if (this.running === task) this.running = undefined;
  }
  setEnabled(enabled) { this.enabled = enabled; this.schedule(); }
  async pause() { this.suspensions++; this.invalidate('paused'); await this.running; }
  resume() { this.suspensions = Math.max(0, this.suspensions - 1); if (!this.suspensions) this.schedule(); }
  dispose() { this.disposed = true; this.generation++; clearTimeout(this.timer); this.cancellation?.cancel(); }
}
module.exports = { AnalysisScheduler };

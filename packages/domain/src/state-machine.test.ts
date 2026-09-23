import { describe, it, expect } from 'vitest';
import { StateMachine, createTaskStateMachine, createSessionStateMachine } from './state-machine.js';

describe('StateMachine', () => {
  it('starts in initial state', () => {
    const sm = new StateMachine('idle', [
      { from: 'idle', to: 'active', event: 'start' },
    ]);
    expect(sm.getState()).toBe('idle');
  });

  it('transitions on valid event', () => {
    const sm = new StateMachine('idle', [
      { from: 'idle', to: 'active', event: 'start' },
    ]);
    expect(sm.canTransition('start')).toBe(true);
    sm.transition('start');
    expect(sm.getState()).toBe('active');
  });

  it('throws on invalid transition', () => {
    const sm = new StateMachine('idle', [
      { from: 'idle', to: 'active', event: 'start' },
    ]);
    expect(() => sm.transition('stop')).toThrow('Invalid transition');
    expect(sm.getState()).toBe('idle');
  });

  it('tracks history', () => {
    const sm = new StateMachine('idle', [
      { from: 'idle', to: 'active', event: 'start' },
      { from: 'active', to: 'done', event: 'finish' },
    ]);
    sm.transition('start');
    sm.transition('finish');
    expect(sm.getHistory()).toHaveLength(2);
    expect(sm.getHistory()[0].to).toBe('active');
    expect(sm.getHistory()[1].to).toBe('done');
  });

  it('lists valid events', () => {
    const sm = new StateMachine('idle', [
      { from: 'idle', to: 'active', event: 'start' },
      { from: 'active', to: 'done', event: 'finish' },
    ]);
    expect(sm.getValidEvents()).toEqual(['start']);
    sm.transition('start');
    expect(sm.getValidEvents()).toEqual(['finish']);
  });
});

describe('Task state machine', () => {
  it('goes through full lifecycle', () => {
    const sm = createTaskStateMachine();
    expect(sm.getState()).toBe('pending');

    sm.transition('deps_satisfied');
    expect(sm.getState()).toBe('ready');

    sm.transition('start');
    expect(sm.getState()).toBe('running');

    sm.transition('success');
    expect(sm.getState()).toBe('completed');
  });

  it('handles pause/resume', () => {
    const sm = createTaskStateMachine();
    sm.transition('deps_satisfied');
    sm.transition('start');
    sm.transition('pause');
    expect(sm.getState()).toBe('paused');
    sm.transition('resume');
    expect(sm.getState()).toBe('running');
  });

  it('handles retry from failed', () => {
    const sm = createTaskStateMachine();
    sm.transition('deps_satisfied');
    sm.transition('start');
    sm.transition('error');
    expect(sm.getState()).toBe('failed');
    sm.transition('retry');
    expect(sm.getState()).toBe('ready');
  });

  it('handles review flow', () => {
    const sm = createTaskStateMachine();
    sm.transition('deps_satisfied');
    sm.transition('start');
    sm.transition('needs_review');
    expect(sm.getState()).toBe('review');
    sm.transition('approve');
    expect(sm.getState()).toBe('completed');
  });
});

describe('Session state machine', () => {
  it('goes through startup to running', () => {
    const sm = createSessionStateMachine();
    sm.transition('start');
    expect(sm.getState()).toBe('starting');
    sm.transition('running');
    expect(sm.getState()).toBe('running');
  });

  it('handles crash', () => {
    const sm = createSessionStateMachine();
    sm.transition('start');
    sm.transition('running');
    sm.transition('crash');
    expect(sm.getState()).toBe('crashed');
  });
});

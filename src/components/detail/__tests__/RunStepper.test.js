import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import RunStepper from '../RunStepper.vue'

const running = (idx) => Array.from({ length: 5 }, (_, i) => (i < idx ? 'done' : i === idx ? 'running' : 'pending'))

describe('RunStepper question', () => {
  const prompt = { text: 'Open Contact Builder and retry?', confirmLabel: 'Open Contact Builder and retry', cancelLabel: 'Cancel' }
  const details = [null, { prompt }, null, null, null]

  it('shows the question under the running step and emits the answer', async () => {
    const w = mount(RunStepper, { props: { stepStatuses: running(1), stepDetails: details } })
    expect(w.text()).toContain('Open Contact Builder and retry?')
    const buttons = w.findAll('button').filter(b => ['Open Contact Builder and retry', 'Cancel'].includes(b.text()))
    expect(buttons).toHaveLength(2)
    await buttons[0].trigger('click')
    await buttons[1].trigger('click')
    expect(w.emitted('prompt')).toEqual([[true], [false]])
  })

  it('hides the question once the step is no longer running', () => {
    const w = mount(RunStepper, { props: { stepStatuses: ['done', 'error', 'pending', 'pending', 'pending'], stepDetails: details, stepErrors: [null, 'x', null, null, null] } })
    expect(w.text()).not.toContain('Open Contact Builder and retry?')
  })
})

import { describe, expect, it } from 'vitest'
import { validateScenarioMarketing } from '../../server/utils/agents/scenario-marketing-validator'

describe('scenario marketing validator language', () => {
  it('accepts a Russian CTA verb for a Russian app', async () => {
    const result = await validateScenarioMarketing({
      storyPlan: {
        scenes: [{
          order: 1,
          purpose: 'CTA',
          setting: 'студия',
          action: 'героиня обращается к зрителю',
          whatChanges: 'появляется решение',
          emotionalState: 'уверенность',
          appIntegrationBeat: 'призыв',
          visualPromptGuidance: 'woman speaking to camera in a studio',
          subtitleCopy: 'Попробуйте Reforma сегодня',
          subtitlePlacement: { position: 'bottom', alignment: 'center', avoidZones: [] },
          voiceoverLine: 'Попробуйте Reforma сегодня',
          spokenLine: 'Попробуйте Reforma сегодня',
          continuityNotes: '',
          duration: '9s',
          cameraAngle: 'medium shot',
          props: [],
        }],
      } as any,
      cta: 'Попробуйте Reforma сегодня',
      app: { name: 'Reforma', language: 'ru' },
      autoFix: false,
    })

    expect(result.passed).toBe(true)
  })
})

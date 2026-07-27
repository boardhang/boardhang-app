import { describe, expect, it } from 'vitest'
import { classifyCameraError, describeCameraIssue } from './cameraError'

const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
const DESKTOP_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

describe('classifyCameraError', () => {
  it('reads the scanner’s normalised kind', () => {
    expect(classifyCameraError({ kind: 'permission-denied', message: '', cause: null })).toBe(
      'denied',
    )
    expect(classifyCameraError({ kind: 'no-camera', message: '', cause: null })).toBe('no-camera')
    expect(classifyCameraError({ kind: 'in-use', message: '', cause: null })).toBe('in-use')
    expect(classifyCameraError({ kind: 'insecure-context', message: '', cause: null })).toBe(
      'insecure',
    )
  })

  it('falls back to a raw getUserMedia DOMException name', () => {
    // what iOS throws when the camera is off for the browser in Settings
    expect(classifyCameraError(new DOMException('denied', 'NotAllowedError'))).toBe('denied')
    expect(classifyCameraError(new DOMException('busy', 'NotReadableError'))).toBe('in-use')
    expect(classifyCameraError(new DOMException('none', 'NotFoundError'))).toBe('no-camera')
  })

  it('treats anything unrecognised — including a failed decoder load — as unavailable', () => {
    expect(classifyCameraError(new Error('chunk load failed'))).toBe('unavailable')
    expect(classifyCameraError({ kind: 'aborted', message: '', cause: null })).toBe('unavailable')
    expect(classifyCameraError(undefined)).toBe('unavailable')
  })
})

describe('describeCameraIssue', () => {
  it('points iOS users at the Settings app, since the page can never re-prompt', () => {
    const copy = describeCameraIssue('denied', { userAgent: IOS_UA, standalone: false })
    expect(copy.steps?.join(' ')).toMatch(/settings/i)
    // names the browser, because the toggle lives per app (Bluefy, Safari, …)
    expect(copy.steps?.join(' ')).toMatch(/browser/i)
    expect(copy.steps?.join(' ')).toMatch(/camera/i)
  })

  it('names the installed app instead of a browser when running standalone', () => {
    const copy = describeCameraIssue('denied', { userAgent: IOS_UA, standalone: true })
    expect(copy.steps?.join(' ')).toMatch(/boardhang/i)
  })

  it('points other browsers at the address-bar site settings', () => {
    const copy = describeCameraIssue('denied', { userAgent: DESKTOP_UA, standalone: false })
    expect(copy.steps?.join(' ')).toMatch(/address bar/i)
  })

  it('offers no steps for failures the user can’t fix in settings', () => {
    expect(describeCameraIssue('no-camera').steps).toBeUndefined()
    expect(describeCameraIssue('unavailable').steps).toBeUndefined()
    expect(describeCameraIssue('in-use').steps).toBeUndefined()
  })
})

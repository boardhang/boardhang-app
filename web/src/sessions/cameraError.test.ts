import { describe, expect, it } from 'vitest'
import { classifyCameraError, describeCameraIssue } from './cameraError'

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

  it('keeps “this browser has no getUserMedia” apart from “this device has no camera”', () => {
    // The library raises 'unsupported' only when navigator.mediaDevices.getUserMedia is undefined —
    // an in-app webview. Folding it into no-camera would tell a user with a working camera they
    // haven't got one, and hide the fix (open it in a real browser).
    expect(classifyCameraError({ kind: 'unsupported', message: '', cause: null })).toBe(
      'unsupported',
    )
    expect(describeCameraIssue('unsupported').steps?.join(' ')).toMatch(/open boardhang in/i)
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

  it('does not let a prototype-chain key escape the CameraIssue union', () => {
    // A bare `KIND_TO_ISSUE[kind]` read would resolve 'constructor' to Object — truthy, returned as
    // if it were an issue, and then describeCameraIssue has no case for it.
    expect(classifyCameraError({ name: 'constructor' })).toBe('unavailable')
    expect(classifyCameraError({ kind: 'toString' })).toBe('unavailable')
  })
})

describe('describeCameraIssue', () => {
  it('points iOS users at the Settings app, since the page can never re-prompt', () => {
    const copy = describeCameraIssue('denied', { isIOS: true, standalone: false })
    expect(copy.steps?.join(' ')).toMatch(/settings/i)
    // names the browser, because the toggle lives per app (Bluefy, Safari, …)
    expect(copy.steps?.join(' ')).toMatch(/browser/i)
    expect(copy.steps?.join(' ')).toMatch(/camera/i)
  })

  it('names the installed app instead of a browser when running standalone', () => {
    expect(describeCameraIssue('denied', { isIOS: true, standalone: true }).steps?.join(' ')).toMatch(
      /boardhang/i,
    )
  })

  it('points other browsers at the address-bar site settings', () => {
    const copy = describeCameraIssue('denied', { isIOS: false, standalone: false })
    expect(copy.steps?.join(' ')).toMatch(/address bar/i)
  })

  it('sends an installed non-iOS app to OS settings, not an address bar it doesn’t have', () => {
    const copy = describeCameraIssue('denied', { isIOS: false, standalone: true })
    expect(copy.steps?.join(' ')).not.toMatch(/address bar/i)
    expect(copy.steps?.join(' ')).toMatch(/app settings/i)
  })

  it('offers no steps for failures the user can’t fix in settings', () => {
    expect(describeCameraIssue('no-camera').steps).toBeUndefined()
    expect(describeCameraIssue('unavailable').steps).toBeUndefined()
    expect(describeCameraIssue('in-use').steps).toBeUndefined()
    expect(describeCameraIssue('insecure').steps).toBeUndefined()
  })

  it('tells the insecure case to use https', () => {
    expect(describeCameraIssue('insecure').detail).toMatch(/https/i)
  })
})

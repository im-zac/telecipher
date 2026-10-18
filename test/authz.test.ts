import { describe, it, expect } from 'vitest'
import { isAuthorized } from '../server/utils/authz'

describe('isAuthorized', () => {
  it('接受相同 token', () => { expect(isAuthorized('s3cret', 's3cret')).toBe(true) })
  it('拒絕錯誤 token', () => { expect(isAuthorized('nope', 's3cret')).toBe(false) })
  it('拒絕長度不同的 token', () => { expect(isAuthorized('s3cre', 's3cret')).toBe(false) })
  it('未設定 token 時一律拒絕', () => { expect(isAuthorized('anything', '')).toBe(false) })
  it('provided 為 undefined 時拒絕', () => { expect(isAuthorized(undefined, 's3cret')).toBe(false) })
})

export const passwordRequirement = "Use at least 8 characters, including an uppercase letter, a number, and a special character."

const passwordRule = /^(?=.*[A-Z])(?=.*[0-9])(?=.*[\x21-\x2F\x3A-\x40\x5B-\x60\x7B-\x7E]).{8,}$/u

export function meetsPasswordRequirements(password: string) {
  return passwordRule.test(password)
}

export function requireStrongPassword(password: string) {
  if (!meetsPasswordRequirements(password)) throw new Error(passwordRequirement)
}

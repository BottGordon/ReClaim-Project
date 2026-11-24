import { useState, type FormEvent } from "react"
import { confirmPhoneChange, requestPhoneChange } from "./lib/api"

export const phonePattern = "\\+63 9[0-9]{9}"
export const phonePlaceholder = "+63 9XXXXXXXXX"
export const phoneHint = "Enter exactly 10 digits starting with 9, for example 9123456789."

export function phoneInput(value: string) {
  if (value === "+" || value === "+6" || value === "+63" || value === "+63 ") return ""
  if (value.startsWith("+") && !value.startsWith("+63")) return value
  const national = value.startsWith("+63") ? value.slice(3).trimStart() : value
  return national ? "+63 " + national : ""
}

export function displayPhone(phone: string) {
  const match = /^(?:\+?63 ?|0)?(9[0-9]{9})$/.exec(phone)
  return match ? "+63 " + match[1] : phone
}

export function studentInput(value: string) {
  return value.replace(/[^0-9]/g, "").slice(0, 9)
}

export function PhoneSettings({ phone }: { phone?: string }) {
  const [current, setCurrent] = useState(phone)
  const [next, setNext] = useState("")
  const [code, setCode] = useState("")
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError("")
    try {
      if (sent) {
        const { user } = await confirmPhoneChange(code)
        setCurrent(user.phone)
        setSent(false)
        setNext("")
        setCode("")
        setNotice("Contact number updated.")
      } else {
        const response = await requestPhoneChange(next)
        setSent(true)
        setNotice(response.demoCode ? "Local verification code: " + response.demoCode : "Enter the code sent to your account email.")
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not update the contact number.")
    } finally {
      setBusy(false)
    }
  }

  return <form className="settings-fields" onSubmit={(event) => void submit(event)}>
    <p>Current contact number <b>{current ? displayPhone(current) : "Not provided"}</b></p>
    <label className="field-label">New contact number
      <input className="plain-input w-full" type="tel" pattern={phonePattern} placeholder={phonePlaceholder} title={phoneHint} value={next} onChange={(event) => setNext(phoneInput(event.target.value))} readOnly={sent} required />
    </label>
    <small className="text-muted">{phoneHint}</small>
    {sent && <label className="field-label">Email verification code
      <input className="plain-input w-full" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} pattern="[0-9]{6}" required />
    </label>}
    <div className="flex flex-wrap gap-2">
      <button className="btn-tertiary" disabled={busy}>{sent ? "Verify and update" : "Email a verification code"}</button>
      {sent && <button className="btn-tertiary" type="button" disabled={busy} onClick={() => { setSent(false); setCode(""); setNotice(""); setError("") }}>Change number or resend</button>}
    </div>
    {notice && <p role="status">{notice}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </form>
}

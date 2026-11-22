const TOKEN_KEY = "reclaim.session"
const REMEMBER_KEY = "reclaim.remember"
const API_BASE = import.meta.env.VITE_API_BASE || ""

export type ApiUser = {
  id: string
  name: string
  initials?: string
  accountType: "PLM Student" | "PLM Staff" | "External User"
  email: string
  studentNumber?: string
  staffId?: string
  yearLevel?: string
  course?: string
  college?: string
  school?: string
  phone?: string
  photo?: string
  role: string
}

export type ApiItem = {
  id: number
  name: string
  category: string
  status: "Lost" | "Found" | "Pending Claim" | "Claimed" | "Returned"
  date: string
  location: string
  description: string
  image: string
  reporter: string
  reporterRole: string
  question?: string
  answer?: string
  mine?: boolean
  ownerId?: string
  rewardType?: "none" | "money" | "other"
  rewardAmount?: string
  rewardDescription?: string
}

export type ApiClaim = {
  id: number
  itemId: number
  claimant: string
  claimantId?: string
  accountType: string
  status: "Pending" | "Approved" | "Rejected" | "Returned to another claimant"
  requested: string
  verified: boolean
  explanation: string
  proof?: string
}

export type ApiMessage = { id: number; mine: boolean; text: string; time: string; read?: boolean }
export type ApiConversation = {
  id: number
  itemId: number
  user: string
  avatar: string
  unread: number
  messages: ApiMessage[]
}
export type ApiNotification = {
  id: string
  type: string
  title: string
  text: string
  time: string
  unread: boolean
  target: string
}
export type Bootstrap = {
  user: ApiUser
  items: ApiItem[]
  claims: ApiClaim[]
  conversations: ApiConversation[]
  notifications: ApiNotification[]
}

type ApiError = Error & { status?: number; code?: string }

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (!(init.body instanceof FormData)) headers.set("Content-Type", "application/json")
  const token = localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY)
  if (token) headers.set("Authorization", `Bearer ${token}`)
  let response: Response
  try {
    response = await fetch(`${API_BASE}/api${path}`, { ...init, headers })
  } catch {
    throw new Error("Could not reach the ReClaim API. Start the backend server and try again.")
  }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status}).`) as ApiError
    error.status = response.status
    error.code = data.code
    throw error
  }
  return data as T
}

function rememberSession(token: string, remember = true) {
  clearSession()
  ;(remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, token)
  localStorage.setItem(REMEMBER_KEY, String(remember))
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY)
  sessionStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(REMEMBER_KEY)
}

export async function login(email: string, password: string, remember = true) {
  const result = await request<{ token: string; user: ApiUser }>("/auth/login", {
    method: "POST", body: JSON.stringify({ email, password }),
  })
  rememberSession(result.token, remember)
  return result.user
}

export async function register(input: Record<string, string>) {
  return request<{ message: string; demoCode?: string }>("/auth/register", {
    method: "POST", body: JSON.stringify(input),
  })
}

export function startRegistration(email: string, accountType = "PLM") {
  return request<{ message: string; demoCode?: string }>("/auth/start-registration", {
    method: "POST", body: JSON.stringify({ email, accountType }),
  })
}

export function verifyRegistrationEmail(email: string, code: string) {
  return request<{ verified: boolean }>("/auth/verify-registration-email", {
    method: "POST", body: JSON.stringify({ email, code }),
  })
}

export async function resendVerification(email: string) {
  return request<{ message: string; demoCode?: string }>("/auth/resend-verification", {
    method: "POST", body: JSON.stringify({ email }),
  })
}

export function requestPasswordReset(email: string) {
  return request<{ message: string; demoCode?: string }>("/auth/forgot-password", {
    method: "POST", body: JSON.stringify({ email }),
  })
}

export function resetPassword(email: string, code: string, password: string) {
  return request<{ message: string }>("/auth/reset-password", {
    method: "POST", body: JSON.stringify({ email, code, password }),
  })
}

export function verifyPasswordReset(email: string, code: string) {
  return request<{ verified: boolean }>("/auth/verify-password-reset", {
    method: "POST", body: JSON.stringify({ email, code }),
  })
}

export function bootstrap() {
  return request<Bootstrap>("/bootstrap")
}

export async function logout() {
  try { await request<{ ok: boolean }>("/auth/logout", { method: "POST" }) }
  finally { clearSession() }
}

export async function createItem(input: Omit<ApiItem, "id" | "date" | "reporter" | "reporterRole" | "ownerId" | "mine">) {
  return (await request<{ item: ApiItem }>("/items", { method: "POST", body: JSON.stringify(input) })).item
}

export async function createClaim(input: { itemId: number; answer: string; explanation: string; proof: string }) {
  return request<{ claim: ApiClaim }>("/claims", { method: "POST", body: JSON.stringify(input) })
}

export function verifyAnswer(itemId: number, answer: string) {
  return request<{ verified: boolean }>(`/items/${itemId}/verify-answer`, {
    method: "POST", body: JSON.stringify({ answer }),
  })
}

export async function startConversation(itemId: number) {
  return (await request<{ conversation: ApiConversation }>("/conversations", {
    method: "POST", body: JSON.stringify({ itemId }),
  })).conversation
}

export async function updateClaim(id: number, status: "Approved" | "Rejected") {
  return request<{ claim: ApiClaim; item: ApiItem }>(`/claims/${id}`, { method: "PATCH", body: JSON.stringify({ status }) })
}

export async function markReturned(id: number) {
  return request<{ item: ApiItem }>(`/items/${id}/returned`, { method: "PATCH", body: "{}" })
}

export async function undoReturned(id: number) {
  return request<{ item: ApiItem }>(`/items/${id}/undo-return`, { method: "PATCH", body: "{}" })
}

export async function sendMessage(conversationId: number, text: string) {
  return request<{ message: ApiMessage }>(`/conversations/${conversationId}/messages`, {
    method: "POST", body: JSON.stringify({ text }),
  })
}

export function markConversationRead(conversationId: number) {
  return request<{ ok: boolean }>(`/conversations/${conversationId}/read`, {
    method: "PATCH", body: "{}",
  })
}

export async function setNotificationRead(id: string, unread: boolean) {
  return request<{ notification: ApiNotification }>(`/notifications/${id}`, {
    method: "PATCH", body: JSON.stringify({ unread }),
  })
}

export async function saveProfile(input: { photo: string }) {
  return (await request<{ user: ApiUser }>("/profile", { method: "PATCH", body: JSON.stringify(input) })).user
}

export function changePassword(currentPassword: string, newPassword: string) {
  return request<{ message: string }>("/profile/password", {
    method: "PUT", body: JSON.stringify({ currentPassword, newPassword }),
  })
}


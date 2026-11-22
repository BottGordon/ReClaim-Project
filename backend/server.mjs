import { createServer } from "node:http"
import { randomBytes, randomInt, scrypt as scryptCallback, timingSafeEqual } from "node:crypto"
import { promisify } from "node:util"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scrypt = promisify(scryptCallback)
const root = path.dirname(fileURLToPath(import.meta.url))
try {
  const envFile = await readFile(path.join(root, "..", ".env"), "utf8")
  for (const line of envFile.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2")
  }
} catch (error) {
  if (error.code !== "ENOENT") throw error
}
const dataDir = path.join(root, "data")
const dataFile = path.join(dataDir, "reclaim.json")
const port = Number(process.env.API_PORT || 3001)
const maxBodyBytes = 6 * 1024 * 1024
const sessions = new Map()
const challenges = new Map()
const preverifiedEmails = new Map()
const resetVerifiedEmails = new Map()
const answerAttempts = new Map()
let graphToken
let graphTokenExpires = 0
const emptyDb = { users: [], items: [], claims: [], conversations: [], notifications: [] }
const seedItems = [
  { id: 1, name: "Black leather wallet", category: "Accessories", status: "Found", date: "May 18, 2025", createdAt: "2025-05-18T09:00:00.000Z", location: "University Library, 2nd floor", description: "A slim black leather wallet was found beside the north reading area. Contents are secured and will be used only for ownership verification.", image: "https://images.unsplash.com/photo-1579014134953-1580d7f123f3?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080", reporter: "Mika Reyes", reporterRole: "PLM Student", ownerId: "seed-mika", question: "What small symbol is embossed inside the wallet?", answer: "star" },
  { id: 2, name: "Silver laptop with clear case", category: "Electronics", status: "Lost", date: "May 17, 2025", createdAt: "2025-05-17T15:30:00.000Z", location: "Gusaling Villegas, Room 307", description: "13-inch silver laptop in a clear shell with two small stickers near the trackpad. Last seen after an afternoon lecture.", image: "https://images.unsplash.com/photo-1589979034086-5885b60c8f59?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080", reporter: "Paolo Santos", reporterRole: "PLM Student", ownerId: "seed-paolo", rewardType: "money", rewardAmount: "500" },
  { id: 3, name: "PLM student ID", category: "IDs and Cards", status: "Found", date: "May 17, 2025", createdAt: "2025-05-17T14:00:00.000Z", location: "University Activity Center", description: "Student identification card found near the west entrance. The name and number are hidden for the owner’s privacy.", image: "https://images.unsplash.com/photo-1606761568499-6d2451b23c66?auto=format&fit=crop&w=1200&q=80", reporter: "Elena Cruz", reporterRole: "PLM Staff", ownerId: "seed-elena", question: "What is the last digit of your student number?", answer: "7" },
  { id: 4, name: "White wireless earbuds", category: "Electronics", status: "Pending Claim", date: "May 16, 2025", createdAt: "2025-05-16T13:00:00.000Z", location: "Tanghalang Bayan", description: "Wireless earbuds in a white charging case, found under a seat after a student assembly.", image: "https://images.unsplash.com/photo-1498049794561-7780e7231661?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080", reporter: "Mika Reyes", reporterRole: "PLM Student", ownerId: "seed-mika", question: "What word is written under the case?", answer: "north" },
  { id: 5, name: "Scientific calculator", category: "Electronics", status: "Found", date: "May 15, 2025", createdAt: "2025-05-15T12:00:00.000Z", location: "College of Engineering lobby", description: "Dark scientific calculator with a protective cover and a faded label on the back.", image: "https://images.unsplash.com/photo-1516201580490-33550d32de5c?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080", reporter: "Nathan Lim", reporterRole: "PLM Student", ownerId: "seed-nathan", question: "What are the initials on the back label?", answer: "ncl" },
  { id: 6, name: "Constitutional Law notes", category: "Books and Notes", status: "Lost", date: "May 15, 2025", createdAt: "2025-05-15T10:00:00.000Z", location: "Justo Albert Auditorium", description: "Blue binder containing handwritten Constitutional Law notes and highlighted reading materials.", image: "https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?auto=format&fit=crop&w=1200&q=80", reporter: "Alyssa Mendoza", reporterRole: "PLM Student", ownerId: "seed-alyssa", rewardType: "other", rewardDescription: "Coffee and a meal voucher" },
  { id: 7, name: "Keyring with blue tag", category: "Accessories", status: "Returned", date: "May 14, 2025", createdAt: "2025-05-14T16:00:00.000Z", location: "PLM Chapel walkway", description: "Three keys on a silver ring with a small blue acrylic tag. Successfully returned to its owner.", image: "https://images.unsplash.com/photo-1582139329536-e7284fece509?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080", reporter: "Mika Reyes", reporterRole: "PLM Student", ownerId: "seed-mika" },
  { id: 8, name: "Android smartphone", category: "Electronics", status: "Found", date: "May 14, 2025", createdAt: "2025-05-14T14:00:00.000Z", location: "Intramuros Gate entrance", description: "Dark Android phone in a textured case. Screen is locked and the device is being kept safely.", image: "https://images.unsplash.com/photo-1542351967-d5ae722fed71?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080", reporter: "Carlos Villanueva", reporterRole: "External User", ownerId: "seed-carlos", question: "What color is the lock-screen wallpaper?", answer: "green" },
  { id: 9, name: "Cream folding umbrella", category: "Others", status: "Lost", date: "May 13, 2025", createdAt: "2025-05-13T11:00:00.000Z", location: "Pamantasan Gymnasium", description: "Compact cream umbrella with a wooden handle and a tan wrist strap.", image: "https://images.unsplash.com/photo-1551492625-0ad059e5f5e5?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080", reporter: "Bea Navarro", reporterRole: "PLM Student", ownerId: "seed-bea", rewardType: "none" },
]
let writeQueue = Promise.resolve()
function persist() {
  writeQueue = writeQueue.then(() => writeFile(dataFile, JSON.stringify(db, null, 2)))
  return writeQueue
}

await mkdir(dataDir, { recursive: true })
let db
try {
  db = { ...emptyDb, ...JSON.parse(await readFile(dataFile, "utf8")) }
} catch (error) {
  if (error.code !== "ENOENT") throw error
  db = structuredClone(emptyDb)
  await persist()
}

if (!Array.isArray(db.items) || db.items.length === 0) {
  db.items = structuredClone(seedItems)
  await persist()
}

const send = (res, status, body) => {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  })
  res.end(JSON.stringify(body))
}

async function body(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBodyBytes) throw Object.assign(new Error("Request is too large."), { status: 413 })
    chunks.push(chunk)
  }
  if (!size) return {}
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) }
  catch { throw Object.assign(new Error("Request body must be valid JSON."), { status: 400 }) }
}

const clean = (value, max = 500) => String(value ?? "").trim().slice(0, max)
const required = (value, label, max = 500) => {
  const result = clean(value, max)
  if (!result) throw Object.assign(new Error(`${label} is required.`), { status: 400 })
  return result
}
const id = (prefix = "") => `${prefix}${randomBytes(12).toString("hex")}`
const dateNow = () => new Date().toISOString()
const displayDate = () => new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date())
const publicUser = (user) => {
  const { passwordHash, ...safe } = user
  return safe
}
const userById = (userId) => db.users.find((entry) => entry.id === userId)
const itemById = (itemId) => db.items.find((entry) => entry.id === itemId)

function currentUser(req) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "")
  const userId = token && sessions.get(token)
  return userId ? userById(userId) : undefined
}
function requireUser(req) {
  const user = currentUser(req)
  if (!user) throw Object.assign(new Error("Sign in to continue."), { status: 401 })
  return user
}
function makeSession(user) {
  const token = randomBytes(32).toString("hex")
  sessions.set(token, user.id)
  return { token, user: publicUser(user) }
}
async function passwordHash(password, salt = randomBytes(16).toString("hex")) {
  const derived = await scrypt(password, salt, 64)
  return `${salt}:${derived.toString("hex")}`
}
async function passwordMatches(password, stored) {
  if (!stored) return false
  const [salt, value] = stored.split(":")
  const derived = await scrypt(password, salt, 64)
  const expected = Buffer.from(value, "hex")
  return expected.length === derived.length && timingSafeEqual(expected, derived)
}
function makeCode(email, purpose) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0")
  challenges.set(`${purpose}:${email}`, { code, expiresAt: Date.now() + 15 * 60_000, attempts: 0 })
  return code
}
function verifyCode(email, purpose, code) {
  const key = `${purpose}:${email}`
  const challenge = challenges.get(key)
  if (!challenge || challenge.expiresAt < Date.now() || challenge.attempts >= 5) {
    challenges.delete(key)
    throw Object.assign(new Error("That code is expired. Request a new one."), { status: 400 })
  }
  challenge.attempts += 1
  if (challenge.code !== clean(code, 6)) throw Object.assign(new Error("The verification code is incorrect."), { status: 400 })
  challenges.delete(key)
}
function addNotification(userId, type, title, text, target) {
  db.notifications.unshift({ id: id("n_"), userId, type, title, text, time: "Just now", unread: true, target })
}
function notifyPrototypeCode(purpose, email, code) {
  return sendVerificationEmail(purpose, email, code).then(() => {
    if (!process.env.MS_GRAPH_CLIENT_ID && process.env.NODE_ENV !== "production") {
      console.info(`[ReClaim demo] ${purpose} code for ${email}: ${code}`)
      return { demoCode: code }
    }
    return {}
  })
}

async function sendVerificationEmail(purpose, email, code) {
  const { MS_GRAPH_TENANT_ID: tenant, MS_GRAPH_CLIENT_ID: clientId, MS_GRAPH_CLIENT_SECRET: clientSecret, MS_GRAPH_SENDER: sender } = process.env
  if (!(tenant && clientId && clientSecret && sender)) {
    if (process.env.NODE_ENV === "production") throw Object.assign(new Error("Email delivery is not configured. Contact the ReClaim administrator."), { status: 503 })
    console.info(`[ReClaim demo] ${purpose} code for ${email}: ${code}`)
    return
  }
  if (!graphToken || graphTokenExpires < Date.now() + 60_000) {
    const tokenResponse = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
    })
    const tokenData = await tokenResponse.json()
    if (!tokenResponse.ok) throw Object.assign(new Error("Microsoft email service could not authorize ReClaim."), { status: 502 })
    graphToken = tokenData.access_token
    graphTokenExpires = Date.now() + Number(tokenData.expires_in || 3600) * 1000
  }
  const reset = purpose.toLowerCase().includes("reset")
  const subject = reset ? "ReClaim password reset code" : "Verify your email for ReClaim"
  const message = reset
    ? `Your ReClaim password reset code is ${code}. It expires in 15 minutes. If you did not request this, ignore this email.`
    : `Your ReClaim verification code is ${code}. It expires in 15 minutes. Enter it in ReClaim to continue creating your account.`
  const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
    method: "POST", headers: { authorization: `Bearer ${graphToken}`, "content-type": "application/json" },
    body: JSON.stringify({ message: { subject, body: { contentType: "Text", content: message }, toRecipients: [{ emailAddress: { address: email } }] }, saveToSentItems: true }),
  })
  if (!response.ok) throw Object.assign(new Error("Could not deliver the verification email."), { status: 502 })
}

const validPlmEmail = (email) => /^[^\s@]+@plm\.edu\.ph$/i.test(email)
const validPassword = (password) => /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/.test(password)

async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`)
  const route = url.pathname.replace(/\/+$/, "") || "/"
  const method = req.method || "GET"
  try {
    if (method === "GET" && route === "/api/health") return send(res, 200, { ok: true, service: "reclaim-api" })

    if (method === "POST" && route === "/api/auth/register") {
      const input = await body(req)
      const email = required(input.email, "Email", 254).toLowerCase()
      const password = required(input.password, "Password", 200)
      const external = input.accountType === "External User"
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Object.assign(new Error("Enter a valid email address."), { status: 400 })
      if (!external && !validPlmEmail(email)) throw Object.assign(new Error("Use your official @plm.edu.ph email address for a PLM account."), { status: 400 })
      if (!validPassword(password)) throw Object.assign(new Error("Password must be 8+ characters and include an uppercase letter, a number, and a special character."), { status: 400 })
      if (db.users.some((user) => user.email === email)) throw Object.assign(new Error("An account with this email already exists."), { status: 409 })
      if (!preverifiedEmails.has(email) || preverifiedEmails.get(email) < Date.now()) throw Object.assign(new Error("Verify your email before submitting your details."), { status: 403 })
      const accountType = external ? "External User" : input.role === "staff" ? "PLM Staff" : "PLM Student"
      const user = {
        id: id("u_"), name: required(input.name, "Full name", 100), email,
        accountType, role: accountType, phone: clean(input.phone, 30),
        passwordHash: await passwordHash(password), emailVerified: true,
        createdAt: dateNow(),
        ...(external ? { school: clean(input.school, 120) } : accountType === "PLM Student" ? { studentNumber: required(input.idNumber, "Student number", 40) } : { staffId: required(input.idNumber, "Staff ID", 40) }),
      }
      db.users.push(user)
      preverifiedEmails.delete(email)
      await persist()
      return send(res, 201, { message: "Account created. You can now sign in." })
    }

    if (method === "POST" && route === "/api/auth/start-registration") {
      const input = await body(req)
      const email = required(input.email, "Email", 254).toLowerCase()
      const external = input.accountType === "External User"
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Object.assign(new Error("Enter a valid email address."), { status: 400 })
      if (!external && !validPlmEmail(email)) throw Object.assign(new Error("Use your official @plm.edu.ph email address for a PLM account."), { status: 400 })
      if (db.users.some((entry) => entry.email === email)) throw Object.assign(new Error("An account with this email already exists."), { status: 409 })
      const code = makeCode(email, "verify")
      const delivery = await notifyPrototypeCode("Email verification", email, code)
      return send(res, 200, { message: "A verification code was sent to your email inbox.", ...delivery })
    }

    if (method === "POST" && route === "/api/auth/verify-registration-email") {
      const input = await body(req)
      const email = required(input.email, "Email", 254).toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Object.assign(new Error("Enter a valid email address."), { status: 400 })
      if (db.users.some((entry) => entry.email === email)) throw Object.assign(new Error("An account with this email already exists."), { status: 409 })
      verifyCode(email, "verify", input.code)
      preverifiedEmails.set(email, Date.now() + 30 * 60_000)
      return send(res, 200, { verified: true })
    }

    if (method === "POST" && route === "/api/auth/verify") {
      const input = await body(req)
      const email = required(input.email, "Email", 254).toLowerCase()
      if (!validPlmEmail(email)) throw Object.assign(new Error("Use your official @plm.edu.ph email address."), { status: 400 })
      const user = db.users.find((entry) => entry.email === email)
      if (!user) throw Object.assign(new Error("Account not found."), { status: 404 })
      verifyCode(email, "verify", input.code)
      user.emailVerified = true
      await persist()
      return send(res, 200, makeSession(user))
    }

    if (method === "POST" && route === "/api/auth/resend-verification") {
      const input = await body(req)
      const email = required(input.email, "Email", 254).toLowerCase()
      if (!validPlmEmail(email)) throw Object.assign(new Error("Use your official @plm.edu.ph email address."), { status: 400 })
      const user = db.users.find((entry) => entry.email === email)
      if (!user) return send(res, 200, { message: "If the account exists, a new code was generated." })
      if (user.emailVerified) throw Object.assign(new Error("This email is already verified."), { status: 409 })
      const code = makeCode(email, "verify")
      const delivery = await notifyPrototypeCode("Email verification", email, code)
      return send(res, 200, { message: "A new verification code was sent.", ...delivery })
    }

    if (method === "POST" && route === "/api/auth/login") {
      const input = await body(req)
      const email = required(input.email, "Email", 254).toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Object.assign(new Error("Enter the email address you used to register."), { status: 400 })
      const user = db.users.find((entry) => entry.email === email)
      if (!user || !(await passwordMatches(String(input.password || ""), user.passwordHash))) throw Object.assign(new Error("Email or password is incorrect."), { status: 401 })
      if (!user.emailVerified) throw Object.assign(new Error("Verify your email before signing in."), { status: 403, code: "EMAIL_NOT_VERIFIED" })
      return send(res, 200, makeSession(user))
    }

    if (method === "POST" && route === "/api/auth/forgot-password") {
      const input = await body(req)
      const email = required(input.email, "Email", 254).toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Object.assign(new Error("Enter a valid email address."), { status: 400 })
      const user = db.users.find((entry) => entry.email === email)
      if (!user) return send(res, 200, { message: "If the account exists, a reset code was generated." })
      const code = makeCode(email, "reset")
      const delivery = await notifyPrototypeCode("Password reset", email, code)
      return send(res, 200, { message: "A reset code was sent to your account email.", ...delivery })
    }

    if (method === "POST" && route === "/api/auth/reset-password") {
      const input = await body(req)
      const email = required(input.email, "Email", 254).toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Object.assign(new Error("Enter a valid email address."), { status: 400 })
      const password = required(input.password, "New password", 200)
      if (!validPassword(password)) throw Object.assign(new Error("Password must be 8+ characters and include an uppercase letter, a number, and a special character."), { status: 400 })
      const user = db.users.find((entry) => entry.email === email)
      if (!user) throw Object.assign(new Error("Account not found."), { status: 404 })
      if (!resetVerifiedEmails.has(email) || resetVerifiedEmails.get(email) < Date.now()) throw Object.assign(new Error("Verify the reset code before choosing a new password."), { status: 403 })
      user.passwordHash = await passwordHash(password)
      resetVerifiedEmails.delete(email)
      for (const [token, userId] of sessions) if (userId === user.id) sessions.delete(token)
      await persist()
      return send(res, 200, { message: "Password updated." })
    }

    if (method === "POST" && route === "/api/auth/verify-password-reset") {
      const input = await body(req)
      const email = required(input.email, "Email", 254).toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Object.assign(new Error("Enter a valid email address."), { status: 400 })
      if (!db.users.some((entry) => entry.email === email)) throw Object.assign(new Error("If the account exists, a reset code was sent."), { status: 404 })
      verifyCode(email, "reset", input.code)
      resetVerifiedEmails.set(email, Date.now() + 15 * 60_000)
      return send(res, 200, { verified: true })
    }
    if (method === "POST" && route === "/api/auth/logout") {
      const token = req.headers.authorization?.replace(/^Bearer\s+/i, "")
      if (token) sessions.delete(token)
      return send(res, 200, { ok: true })
    }

    if (method === "GET" && route === "/api/auth/me") return send(res, 200, { user: publicUser(requireUser(req)) })

    if (method === "GET" && route === "/api/bootstrap") {
      const user = requireUser(req)
      return send(res, 200, {
        user: publicUser(user),
        items: [...db.items].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((item) => {
          if (item.ownerId === user.id) return item
          const { answer, ...publicItem } = item
          return publicItem
        }),
        claims: db.claims.filter((claim) => claim.claimantId === user.id || itemById(claim.itemId)?.ownerId === user.id),
        conversations: db.conversations.filter((conversation) => conversation.participantIds.includes(user.id)).map((conversation) => ({
          id: conversation.id, itemId: conversation.itemId,
          user: conversation.participantIds.find((participant) => participant !== user.id) ? userById(conversation.participantIds.find((participant) => participant !== user.id))?.name || "ReClaim user" : "ReClaim user",
          avatar: "RC", unread: conversation.messages.filter((message) => message.senderId !== user.id && !message.readBy?.includes(user.id)).length,
          messages: conversation.messages.map((message) => { const mine = message.senderId === user.id; const otherUserId = conversation.participantIds.find((participant) => participant !== user.id); return { id: message.id, mine, text: message.text, time: message.time, read: (message.readBy || []).includes(mine ? otherUserId : user.id) } }),
        })),
        notifications: db.notifications.filter((notification) => notification.userId === user.id),
      })
    }

    const user = currentUser(req)
    if (!user) throw Object.assign(new Error("Sign in to continue."), { status: 401 })

    if (method === "GET" && route === "/api/items") return send(res, 200, {
      items: db.items.map((item) => {
        if (item.ownerId === user.id) return item
        const { answer, ...publicItem } = item
        return publicItem
      }),
    })

    if (method === "POST" && route === "/api/items") {
      const input = await body(req)
      const status = input.status === "Found" ? "Found" : "Lost"
      const image = clean(input.image, maxBodyBytes)
      if (image && !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(image) && !/^https:\/\/images\.unsplash\.com\//.test(image)) throw Object.assign(new Error("Upload a PNG, JPEG, WebP, or GIF image."), { status: 400 })
      const item = {
        id: Date.now(), name: required(input.name, "Item name", 120), category: required(input.category, "Category", 50),
        status, date: clean(input.date, 20) || displayDate(), createdAt: dateNow(), location: required(input.location, "Location", 160),
        description: required(input.description, "Description", 1500), image,
        reporter: user.name, reporterRole: user.accountType, ownerId: user.id, mine: true,
        question: status === "Found" ? required(input.question, "Private ownership question", 200) : undefined,
        answer: status === "Found" ? required(input.answer, "Private answer", 200).toLowerCase() : undefined,
        rewardType: status === "Lost" ? ["none", "money", "other"].includes(input.rewardType) ? input.rewardType : "none" : undefined,
        rewardAmount: status === "Lost" ? clean(input.rewardAmount, 40) : undefined,
        rewardDescription: status === "Lost" ? clean(input.rewardDescription, 200) : undefined,
      }
      db.items.unshift(item)
      await persist()
      return send(res, 201, { item })
    }

    const questionMatch = route.match(/^\/api\/items\/(\d+)\/verify-answer$/)
    if (method === "POST" && questionMatch) {
      const input = await body(req)
      const item = itemById(Number(questionMatch[1]))
      if (!item || !["Found", "Pending Claim"].includes(item.status)) throw Object.assign(new Error("This found item is no longer available to claim."), { status: 404 })
      if (item.ownerId === user.id) throw Object.assign(new Error("You cannot claim your own report."), { status: 400 })
      const key = `${user.id}:${item.id}`
      const attempts = answerAttempts.get(key) || 0
      if (attempts >= 5) throw Object.assign(new Error("Too many attempts. Contact the reporter for help."), { status: 429 })
      answerAttempts.set(key, attempts + 1)
      if (clean(input.answer, 200).toLowerCase() !== (item.answer || "")) throw Object.assign(new Error("That answer does not match. Check the item details you remember and try again."), { status: 403 })
      return send(res, 200, { verified: true })
    }

    if (method === "POST" && route === "/api/conversations") {
      const input = await body(req)
      const item = itemById(Number(input.itemId))
      if (!item) throw Object.assign(new Error("Item not found."), { status: 404 })
      if (item.ownerId === user.id) throw Object.assign(new Error("You cannot message yourself."), { status: 400 })
      const existing = db.conversations.find((entry) => entry.itemId === item.id && entry.participantIds.includes(user.id))
      const conversation = existing || { id: Date.now(), itemId: item.id, participantIds: [item.ownerId, user.id], messages: [] }
      if (!existing) db.conversations.unshift(conversation)
      await persist()
      return send(res, 201, { conversation: {
        id: conversation.id, itemId: conversation.itemId,
        user: userById(conversation.participantIds.find((participant) => participant !== user.id))?.name || item.reporter,
        avatar: "RC", unread: 0, messages: conversation.messages.map((message) => { const mine = message.senderId === user.id; const otherUserId = conversation.participantIds.find((participant) => participant !== user.id); return { id: message.id, mine, text: message.text, time: message.time, read: (message.readBy || []).includes(mine ? otherUserId : user.id) } }),
      } })
    }

    if (method === "POST" && route === "/api/claims") {
      const input = await body(req)
      const item = itemById(Number(input.itemId))
      if (!item || !["Found", "Pending Claim"].includes(item.status)) throw Object.assign(new Error("This found item is no longer available to claim."), { status: 404 })
      if (item.ownerId === user.id) throw Object.assign(new Error("You cannot claim your own report."), { status: 400 })
      if (db.claims.some((claim) => claim.itemId === item.id && claim.claimantId === user.id && claim.status === "Pending")) throw Object.assign(new Error("You already have a pending claim for this item."), { status: 409 })
      const answer = clean(input.answer, 200).toLowerCase()
      if (!item.answer || answer !== item.answer) throw Object.assign(new Error("The ownership answer does not match."), { status: 403 })
      const claim = {
        id: Date.now(), itemId: item.id, claimant: user.name, claimantId: user.id, accountType: user.accountType,
        status: "Pending", requested: "Just now", createdAt: dateNow(), verified: true,
        explanation: required(input.explanation, "Ownership details", 1200), proof: clean(input.proof, maxBodyBytes),
      }
      db.claims.unshift(claim)
      item.status = "Pending Claim"
      let conversation = db.conversations.find((entry) => entry.itemId === item.id && entry.participantIds.includes(user.id))
      if (!conversation) {
        conversation = { id: Date.now(), itemId: item.id, participantIds: [item.ownerId, user.id], messages: [] }
        db.conversations.unshift(conversation)
      }
      addNotification(item.ownerId, "claim", "New claim request", `${user.name} submitted a claim for ${item.name}.`, "activity")
      await persist()
      return send(res, 201, { claim })
    }

    const claimMatch = route.match(/^\/api\/claims\/(\d+)$/)
    if (method === "PATCH" && claimMatch) {
      const input = await body(req)
      const claim = db.claims.find((entry) => entry.id === Number(claimMatch[1]))
      const item = claim && itemById(claim.itemId)
      if (!claim || !item) throw Object.assign(new Error("Claim not found."), { status: 404 })
      if (item.ownerId !== user.id) throw Object.assign(new Error("Only the item reporter can review this claim."), { status: 403 })
      if (!(["Approved", "Rejected"].includes(input.status))) throw Object.assign(new Error("Choose Approved or Rejected."), { status: 400 })
      claim.status = input.status
      if (input.status === "Approved") item.approvedClaimantId = claim.claimantId
      else if (item.approvedClaimantId === claim.claimantId) delete item.approvedClaimantId
      item.status = input.status === "Approved" ? "Claimed" : db.claims.some((entry) => entry.itemId === item.id && entry.id !== claim.id && entry.status === "Pending") ? "Pending Claim" : "Found"
      addNotification(claim.claimantId, "claim", `Claim ${input.status.toLowerCase()}`, `Your claim for ${item.name} was ${input.status.toLowerCase()}.`, "activity")
      await persist()
      return send(res, 200, { claim, item })
    }

    const returnedMatch = route.match(/^\/api\/items\/(\d+)\/returned$/)
    if (method === "PATCH" && returnedMatch) {
      const item = itemById(Number(returnedMatch[1]))
      if (!item) throw Object.assign(new Error("Item not found."), { status: 404 })
      if (item.ownerId !== user.id || item.status !== "Claimed") throw Object.assign(new Error("Only the reporter can mark an approved claim as returned."), { status: 403 })
      item.status = "Returned"
      item.returnClaimSnapshot = Object.fromEntries(db.claims.filter((entry) => entry.itemId === item.id).map((entry) => [entry.id, entry.status]))
      addNotification(item.ownerId, "return", "Item successfully returned", `${item.name} was marked as returned.`, "activity")
      for (const claim of db.claims.filter((entry) => entry.itemId === item.id && entry.claimantId !== item.approvedClaimantId && entry.status !== "Rejected")) {
        claim.status = "Returned to another claimant"
        addNotification(claim.claimantId, "return", "Item returned to another claimant", "This item was returned to another claimant.", "activity")
      }
      await persist()
      return send(res, 200, { item })
    }

    const undoReturnedMatch = route.match(/^\/api\/items\/(\d+)\/undo-return$/)
    if (method === "PATCH" && undoReturnedMatch) {
      const item = itemById(Number(undoReturnedMatch[1]))
      if (!item || item.ownerId !== user.id || item.status !== "Returned") throw Object.assign(new Error("Only the finder can undo a return for their returned item."), { status: 403 })
      for (const claim of db.claims.filter((entry) => entry.itemId === item.id)) {
        const previous = item.returnClaimSnapshot?.[claim.id]
        if (previous) claim.status = previous
      }
      delete item.returnClaimSnapshot
      delete item.approvedClaimantId
      item.status = db.claims.some((entry) => entry.itemId === item.id && entry.status === "Pending") ? "Pending Claim" : "Found"
      addNotification(item.ownerId, "return", "Return undone", `${item.name} is open for claims again.`, "activity")
      await persist()
      return send(res, 200, { item })
    }

    if (method === "GET" && route === "/api/notifications") return send(res, 200, { notifications: db.notifications.filter((entry) => entry.userId === user.id) })

    const notificationMatch = route.match(/^\/api\/notifications\/([^/]+)$/)
    if (method === "PATCH" && notificationMatch) {
      const notification = db.notifications.find((entry) => entry.id === notificationMatch[1] && entry.userId === user.id)
      if (!notification) throw Object.assign(new Error("Notification not found."), { status: 404 })
      notification.unread = Boolean((await body(req)).unread)
      await persist()
      return send(res, 200, { notification })
    }

    const messageMatch = route.match(/^\/api\/conversations\/(\d+)\/messages$/)
    if (method === "POST" && messageMatch) {
      const input = await body(req)
      const conversation = db.conversations.find((entry) => entry.id === Number(messageMatch[1]) && entry.participantIds.includes(user.id))
      if (!conversation) throw Object.assign(new Error("Conversation not found."), { status: 404 })
      const text = required(input.text, "Message", 2000)
      const message = { id: Date.now(), senderId: user.id, text, time: "Just now", readBy: [user.id] }
      conversation.messages.push(message)
      const recipientId = conversation.participantIds.find((participant) => participant !== user.id)
      if (recipientId) addNotification(recipientId, "message", "New message", `${user.name} sent you a message.`, "chat")
      await persist()
      return send(res, 201, { message: { id: message.id, mine: true, text: message.text, time: message.time } })
    }

    const readMatch = route.match(/^\/api\/conversations\/(\d+)\/read$/)
    if (method === "PATCH" && readMatch) {
      const conversation = db.conversations.find((entry) => entry.id === Number(readMatch[1]) && entry.participantIds.includes(user.id))
      if (!conversation) throw Object.assign(new Error("Conversation not found."), { status: 404 })
      for (const message of conversation.messages) {
        message.readBy ||= []
        if (!message.readBy.includes(user.id)) message.readBy.push(user.id)
      }
      await persist()
      return send(res, 200, { ok: true })
    }

    if (method === "PATCH" && route === "/api/profile") {
      const input = await body(req)
      if (input.photo !== undefined) {
        const photo = clean(input.photo, 3 * 1024 * 1024)
        if (photo && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(photo)) throw Object.assign(new Error("Upload a PNG, JPEG, or WebP profile photo."), { status: 400 })
        user.photo = photo
      }
      await persist()
      return send(res, 200, { user: publicUser(user) })
    }

    if (method === "PUT" && route === "/api/profile/password") {
      const input = await body(req)
      if (!(await passwordMatches(String(input.currentPassword || ""), user.passwordHash))) throw Object.assign(new Error("Current password is incorrect."), { status: 403 })
      const nextPassword = required(input.newPassword, "New password", 200)
      if (!validPassword(nextPassword)) throw Object.assign(new Error("Password must be 8+ characters and include an uppercase letter, a number, and a special character."), { status: 400 })
      if (nextPassword === input.currentPassword) throw Object.assign(new Error("Choose a password you have not used before."), { status: 400 })
      user.passwordHash = await passwordHash(nextPassword)
      const token = req.headers.authorization?.replace(/^Bearer\s+/i, "")
      for (const [sessionToken, userId] of sessions) if (userId === user.id && sessionToken !== token) sessions.delete(sessionToken)
      await persist()
      return send(res, 200, { message: "Password updated." })
    }

    return send(res, 404, { error: "Endpoint not found." })
  } catch (error) {
    return send(res, error.status || 500, { error: error.message || "Unexpected server error.", ...(error.code ? { code: error.code } : {}) })
  }
}

createServer(handler).listen(port, "127.0.0.1", () => {
  console.log(`ReClaim API listening at http://127.0.0.1:${port}`)
})




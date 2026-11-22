import type { AdminOverview, ApiItem } from "./api"

const samples = [
  { id: 108, name: "Black leather wallet", category: "Accessories", location: "University Library, 2nd Floor", custodyDeskId: "vault", claimant: "M. Lomboy", requested: "18m ago", description: "A black wallet found near the library reading area." },
  { id: 105, name: "Silver laptop with clear case", category: "Electronics", location: "Gusaling Villegas, Room 302", custodyDeskId: "vault", claimant: "C. Marquez", requested: "1h ago", description: "A silver laptop in a clear case, turned in after class." },
  { id: 102, name: "PLM student ID", category: "IDs and Cards", location: "University Activity Center", custodyDeskId: "main-gate", claimant: "J. Aringo", requested: "3h ago", description: "A student ID recovered near the entrance. Identifying details are withheld." },
]

const found: ApiItem[] = samples.map(({ id, name, category, location, custodyDeskId, description }) => ({
  id, name, category, location, custodyDeskId, description, status: "Pending Claim",
  date: "Sample record", image: `/items/${id === 108 ? "wallet" : id === 105 ? "laptop" : "student-id"}.jpg`,
  shelfTag: `Intake shelf · RCL-${id}`, reporter: "Campus desk", reporterRole: "PLM Staff",
}))

export const adminDemo: AdminOverview = {
  items: [
    ...found,
    ...found.map(({ id, name, category, location, description, date }) => ({
      id: id + 100, name, category, location, description, date, image: "",
      reporter: "Sample reporter", reporterRole: "PLM Student", status: "Lost" as const,
    })),
    ...["Campus access card", "Enrollment document"].map((name, index): ApiItem => ({
      id: 111 + index, name, category: "IDs and Cards", location: "Campus desk",
      status: "Found", privacy: "Held", date: "Sample record", image: "",
      description: "Sample document awaiting privacy review.", reporter: "Campus desk", reporterRole: "PLM Staff",
    })),
  ],
  claims: samples.map(({ id, claimant, requested }) => ({
    id, itemId: id, claimant, requested, accountType: "PLM Student", status: "Pending",
    verified: true, explanation: "Sample ownership evidence for the dashboard walkthrough.",
  })),
  desks: [
    { id: "vault", name: "OSDS Main Vault", active: true },
    { id: "main-gate", name: "Main Gate Guardhouse", active: true },
    { id: "library-security", name: "Library Security Desk", active: true },
  ],
  matches: found.map(({ id }) => ({ foundId: id, lostId: id + 100, linked: false })),
  users: [],
  notifications: [],
  claimThreads: samples.map(({ id, name }) => ({
    claimId: id,
    messages: [
      { id: 1, mine: false, text: `I submitted ownership details for the ${name.toLowerCase()}.`, time: "Sample" },
      { id: 2, mine: true, text: "The campus desk has received the claim and is checking the evidence.", time: "Sample" },
    ],
  })),
  stats: {
    items: 8, pendingClaims: 3, inCustody: 14, activeReports: 38, returnedItems: 142, returnRate: 92,
    analytics: [
      { location: "University Library", reports: 48, returned: 45 },
      { location: "Gusaling Villegas (GV)", reports: 39, returned: 35 },
      { location: "University Activity Center", reports: 31, returned: 29 },
      { location: "Gusaling Katipunan (GK)", reports: 24, returned: 21 },
      { location: "Gusaling Lacson (GL)", reports: 19, returned: 17 },
    ],
  },
}

export function combineAdminRecords(live: AdminOverview) {
  const liveItemIds = new Set(live.items.map((item) => item.id))
  const liveClaimIds = new Set(live.claims.map((claim) => claim.id))
  const liveDeskIds = new Set(live.desks.map((desk) => desk.id))
  const items = adminDemo.items.filter((item) => !liveItemIds.has(item.id))
  const itemIds = new Set(items.map((item) => item.id))
  const claims = adminDemo.claims.filter((claim) => itemIds.has(claim.itemId) && !liveClaimIds.has(claim.id))
  const desks = adminDemo.desks.filter((desk) => !liveDeskIds.has(desk.id))
  const matches = adminDemo.matches.filter(({ lostId, foundId }) => itemIds.has(lostId) && itemIds.has(foundId))
  const data: AdminOverview = {
    ...live,
    items: [...items, ...live.items],
    claims: [...claims, ...live.claims],
    desks: [...live.desks, ...desks],
    matches: [...matches, ...live.matches],
    claimThreads: [...live.claimThreads, ...adminDemo.claimThreads.filter((thread) => claims.some((claim) => claim.id === thread.claimId))],
    stats: { ...live.stats, pendingClaims: live.stats.pendingClaims + claims.length },
  }
  return {
    data, itemIds, liveDeskIds,
    claimIds: new Set(claims.map((claim) => claim.id)),
  }
}

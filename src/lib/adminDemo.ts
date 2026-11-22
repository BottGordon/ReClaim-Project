import type { AdminOverview, ApiItem } from "./api"

const samples = [
  { id: 108, name: "Black leather wallet", category: "Accessories", location: "University Library, 2nd Floor", custodyDeskId: "vault", claimant: "M. Lomboy", requested: "18m ago", description: "A black wallet found near the library reading area." },
  { id: 105, name: "Silver laptop with clear case", category: "Electronics", location: "Gusaling Villegas, Room 302", custodyDeskId: "vault", claimant: "C. Marquez", requested: "1h ago", description: "A silver laptop in a clear case, turned in after class." },
  { id: 102, name: "PLM student ID", category: "IDs and Cards", location: "University Activity Center", custodyDeskId: "main-gate", claimant: "J. Aringo", requested: "3h ago", description: "A student ID recovered near the entrance. Identifying details are withheld." },
]

const found: ApiItem[] = samples.map(({ id, name, category, location, custodyDeskId, description }) => ({
  id, name, category, location, custodyDeskId, description, status: "Pending Claim",
  date: "Sample record", image: "", reporter: "Campus desk", reporterRole: "PLM Staff",
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
  ],
  matches: found.map(({ id }) => ({ foundId: id, lostId: id + 100, linked: false })),
  users: [],
  notifications: [],
  claimThreads: [],
  stats: { items: 8, pendingClaims: 3, inCustody: 14, activeReports: 38, returnedItems: 142, returnRate: 92, analytics: [] },
}
